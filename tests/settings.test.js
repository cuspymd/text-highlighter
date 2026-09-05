import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import {
  loadPageScript,
  readPageBody,
  stubPageEnvironment,
} from './helpers/extension-page.js';

const SETTINGS_BODY = readPageBody(new URL('../settings.html', import.meta.url));

const BUILT_IN_COLOR = { id: 'yellow', color: '#ffd54f', nameKey: 'colorYellow' };
const CUSTOM_COLOR = { id: 'custom_1', color: '#ff8a80', colorNumber: 1 };
const NAMED_CUSTOM_COLOR = { id: 'custom_2', color: '#82b1ff', colorNumber: 2, customName: 'Ocean' };

const ALL_COLORS = [BUILT_IN_COLOR, CUSTOM_COLOR, NAMED_CUSTOM_COLOR];

const SYNC_CODE = 'ABCD-EFGH-IJKL';

describe('settings', () => {
  let openSettings;

  beforeAll(async () => {
    stubPageEnvironment();
    openSettings = await loadPageScript(() => import('../settings.js'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = SETTINGS_BODY;

    chrome.i18n.getMessage.mockImplementation(key => key);
    chrome.storage.local.get.mockResolvedValue({});
    chrome.commands.getAll.mockResolvedValue([]);
    respondToBackground({});
  });

  /**
   * Answer the page's background messages. `overrides` maps an action to its
   * response; anything not named gets a bare success.
   */
  function respondToBackground(overrides) {
    const defaults = {
      getColors: { success: true, colors: ALL_COLORS },
      getShortcutColorMap: { success: true, shortcutColorMap: {} },
      getCloudSyncStatus: { success: true, code: null },
    };
    const responses = { ...defaults, ...overrides };

    chrome.runtime.sendMessage.mockImplementation(message =>
      Promise.resolve(responses[message.action] ?? { success: true })
    );
  }

  // The page fans its loads out through Promise.all, and its click handlers are
  // async, so assertions need the microtask queue drained first.
  function flush() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  function backgroundMessages(action) {
    return chrome.runtime.sendMessage.mock.calls
      .map(([message]) => message)
      .filter(message => message.action === action);
  }

  function lastMessage(action) {
    return backgroundMessages(action).at(-1);
  }

  async function confirmModal(accept) {
    await flush();
    const button = document.querySelector(accept ? '.modal-confirm' : '.modal-cancel');
    expect(button).not.toBeNull();
    button.click();
    await flush();
  }

  function alertText() {
    return document.querySelector('.modal-content p')?.textContent ?? null;
  }

  function colorRows() {
    return [...document.querySelectorAll('#custom-colors-list .color-row')];
  }

  function colorNames() {
    return colorRows().map(row => row.querySelector('.color-name').textContent);
  }

  function shortcutRows() {
    return [...document.querySelectorAll('#shortcuts-list .shortcut-row')];
  }

  function byId(id) {
    return document.getElementById(id);
  }

  // ===================================================================
  // General settings
  // ===================================================================

  describe('general settings', () => {
    it('defaults the minimap to on when nothing is stored', async () => {
      await openSettings();

      expect(byId('minimap-toggle').checked).toBe(true);
    });

    it('reflects a stored minimap preference of off', async () => {
      chrome.storage.local.get.mockResolvedValue({ minimapVisible: false });
      await openSettings();

      expect(byId('minimap-toggle').checked).toBe(false);
    });

    it('saves the minimap preference when it is toggled', async () => {
      await openSettings();

      const toggle = byId('minimap-toggle');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change'));
      await flush();

      expect(lastMessage('saveSettings')).toEqual({
        action: 'saveSettings',
        minimapVisible: false,
      });
    });

    it('saves the selection-controls preference when it is toggled', async () => {
      await openSettings();

      const toggle = byId('selection-controls-toggle');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change'));
      await flush();

      expect(lastMessage('saveSettings')).toEqual({
        action: 'saveSettings',
        selectionControlsVisible: false,
      });
    });


    // One-click highlighting is opt-in: an existing user's icon keeps opening
    // the palette until they ask for something else.
    it('leaves one-click highlighting off when nothing has been stored', async () => {
      await openSettings();

      expect(byId('one-click-highlight-toggle').checked).toBe(false);
    });

    it('restores the stored one-click preference', async () => {
      chrome.storage.local.get.mockResolvedValue({ oneClickHighlightEnabled: true });
      await openSettings();

      expect(byId('one-click-highlight-toggle').checked).toBe(true);
    });

    it('saves the one-click preference when it is toggled', async () => {
      await openSettings();

      const toggle = byId('one-click-highlight-toggle');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change'));
      await flush();

      expect(lastMessage('saveSettings')).toEqual({
        action: 'saveSettings',
        oneClickHighlightEnabled: true,
      });
    });

    // Without the selection icon there is nothing for a one-click press to
    // happen on, so the row says so rather than accepting a dead setting.
    it('disables the one-click row while the selection icon is turned off', async () => {
      chrome.storage.local.get.mockResolvedValue({ selectionControlsVisible: false });
      await openSettings();

      expect(byId('one-click-highlight-toggle').disabled).toBe(true);
      expect(byId('one-click-highlight-row').classList.contains('is-disabled')).toBe(true);

      const selectionControls = byId('selection-controls-toggle');
      selectionControls.checked = true;
      selectionControls.dispatchEvent(new Event('change'));
      await flush();

      expect(byId('one-click-highlight-toggle').disabled).toBe(false);
      expect(byId('one-click-highlight-row').classList.contains('is-disabled')).toBe(false);
    });
    it('hides the selection-controls row where windows is unavailable', async () => {
      await withoutBrowserApi('windows', async () => {
        await openSettings();

        expect(byId('selection-controls-row').style.display).toBe('none');
      });
    });
  });

  /**
   * Run `body` with one extension API missing, the way Firefox for Android
   * presents it. `browserAPI` is the mock object itself, so the property has to
   * come off and go back on.
   */
  async function withoutBrowserApi(name, body) {
    const saved = chrome[name];
    delete chrome[name];
    try {
      await body();
    } finally {
      chrome[name] = saved;
    }
  }

  // ===================================================================
  // Custom colors
  // ===================================================================

  describe('custom colors', () => {
    it('lists the custom colors and leaves the built-in ones out', async () => {
      await openSettings();

      expect(colorRows()).toHaveLength(2);
      expect(colorRows().map(row => row.querySelector('.color-hex').textContent))
        .toEqual(['#FF8A80', '#82B1FF']);
    });

    it('names an unnamed custom color by its number', async () => {
      await openSettings();

      expect(colorNames()).toEqual(['customColor 1', 'Ocean']);
    });

    it('says so when there are no custom colors', async () => {
      respondToBackground({ getColors: { success: true, colors: [BUILT_IN_COLOR] } });
      await openSettings();

      expect(colorRows()).toHaveLength(0);
      expect(byId('custom-colors-list').querySelector('.empty-text').textContent)
        .toBe('noCustomColors');
    });

    it('adds the picked color and re-renders the list', async () => {
      await openSettings();
      const added = { id: 'custom_3', color: '#00e676', colorNumber: 3 };
      respondToBackground({ addColor: { success: true, colors: [...ALL_COLORS, added] } });

      const picker = byId('color-picker-hidden');
      picker.value = '#00e676';
      picker.dispatchEvent(new Event('change'));
      await flush();

      expect(lastMessage('addColor')).toEqual({ action: 'addColor', color: '#00e676' });
      expect(colorRows()).toHaveLength(3);
    });

    it('warns instead of adding when the color is already there', async () => {
      await openSettings();
      respondToBackground({ addColor: { success: true, exists: true } });

      const picker = byId('color-picker-hidden');
      picker.value = '#ff8a80';
      picker.dispatchEvent(new Event('change'));
      await flush();

      expect(alertText()).toBe('colorAlreadyExists');
      expect(colorRows()).toHaveLength(2);
    });

    it('updates the color the edit button selected, not a new one', async () => {
      await openSettings();
      respondToBackground({ updateCustomColor: { success: true, colors: ALL_COLORS } });

      colorRows()[0].querySelectorAll('.btn-icon')[0].click();
      const picker = byId('color-picker-hidden');
      picker.value = '#111111';
      picker.dispatchEvent(new Event('change'));
      await flush();

      expect(lastMessage('updateCustomColor')).toEqual({
        action: 'updateCustomColor',
        id: CUSTOM_COLOR.id,
        color: '#111111',
      });
      expect(backgroundMessages('addColor')).toHaveLength(0);
    });

    it('removes a color and re-renders without it', async () => {
      await openSettings();
      respondToBackground({
        removeCustomColor: { success: true, colors: [BUILT_IN_COLOR, NAMED_CUSTOM_COLOR] },
      });

      colorRows()[0].querySelectorAll('.btn-icon')[1].click();
      await flush();

      expect(lastMessage('removeCustomColor')).toEqual({
        action: 'removeCustomColor',
        id: CUSTOM_COLOR.id,
      });
      expect(colorNames()).toEqual(['Ocean']);
    });

    it('offers the bulk delete only once a second color makes the rows tedious', async () => {
      respondToBackground({ getColors: { success: true, colors: [BUILT_IN_COLOR] } });
      await openSettings();
      expect(byId('clear-custom-colors-btn').hidden).toBe(true);

      respondToBackground({ getColors: { success: true, colors: [BUILT_IN_COLOR, CUSTOM_COLOR] } });
      await openSettings();
      expect(byId('clear-custom-colors-btn').hidden).toBe(true);

      respondToBackground({});
      await openSettings();
      expect(byId('clear-custom-colors-btn').hidden).toBe(false);
    });

    it('leaves the colors alone when the bulk delete is cancelled', async () => {
      await openSettings();

      byId('clear-custom-colors-btn').click();
      await confirmModal(false);

      expect(backgroundMessages('clearCustomColors')).toHaveLength(0);
      expect(colorNames()).toEqual(['customColor 1', 'Ocean']);
    });

    it('clears every custom color once the bulk delete is confirmed', async () => {
      await openSettings();
      respondToBackground({
        clearCustomColors: { success: true, colors: [BUILT_IN_COLOR] },
        getColors: { success: true, colors: [BUILT_IN_COLOR] },
      });

      byId('clear-custom-colors-btn').click();
      await confirmModal(true);

      expect(lastMessage('clearCustomColors')).toEqual({ action: 'clearCustomColors' });
      expect(colorRows()).toHaveLength(0);
      expect(byId('clear-custom-colors-btn').hidden).toBe(true);
    });

    // Committing the edit blurs the input, which hands focus back to the window
    // and runs the page's refresh-on-focus reload. So `getColors` has to agree
    // with the rename the way the real background would, or the reload renders
    // the list back to the old name.
    it('renames a color when the inline edit is committed', async () => {
      await openSettings();
      const renamed = { ...CUSTOM_COLOR, customName: 'Coral' };
      const afterRename = { success: true, colors: [BUILT_IN_COLOR, renamed, NAMED_CUSTOM_COLOR] };
      respondToBackground({
        updateCustomColorName: afterRename,
        getColors: afterRename,
      });

      colorRows()[0].querySelector('.color-name').click();
      const input = document.querySelector('.color-name-input');
      input.value = 'Coral';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await flush();

      expect(lastMessage('updateCustomColorName')).toEqual({
        action: 'updateCustomColorName',
        id: CUSTOM_COLOR.id,
        name: 'Coral',
      });
      expect(colorNames()).toEqual(['Coral', 'Ocean']);
    });

    it('abandons the rename on Escape without asking the background', async () => {
      await openSettings();

      colorRows()[0].querySelector('.color-name').click();
      const input = document.querySelector('.color-name-input');
      input.value = 'Discarded';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await flush();

      expect(backgroundMessages('updateCustomColorName')).toHaveLength(0);
      expect(colorNames()).toEqual(['customColor 1', 'Ocean']);
    });

    it('warns and restores the old name when the new one is taken', async () => {
      await openSettings();
      respondToBackground({ updateCustomColorName: { success: true, exists: true } });

      colorRows()[0].querySelector('.color-name').click();
      const input = document.querySelector('.color-name-input');
      input.value = 'Ocean';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await flush();

      expect(alertText()).toBe('nameAlreadyExists');
      expect(colorNames()).toEqual(['customColor 1', 'Ocean']);
    });
  });

  // ===================================================================
  // Keyboard shortcuts
  // ===================================================================

  describe('keyboard shortcuts', () => {
    it('renders a row per shortcut slot', async () => {
      await openSettings();

      expect(shortcutRows()).toHaveLength(5);
    });

    it('shows the assigned key, and says so when there is none', async () => {
      chrome.commands.getAll.mockResolvedValue([
        { name: 'command_slot_1', shortcut: 'Alt+1' },
        { name: 'command_slot_2', shortcut: '' },
      ]);
      await openSettings();

      const badges = shortcutRows().map(row => row.querySelector('.key-badge').textContent);
      expect(badges[0]).toBe('Alt+1');
      expect(badges[1]).toBe('notAssigned');
    });

    it('offers every color, plus an unassigned option', async () => {
      await openSettings();

      const options = [...shortcutRows()[0].querySelectorAll('option')];
      expect(options.map(option => option.value))
        .toEqual(['', BUILT_IN_COLOR.id, CUSTOM_COLOR.id, NAMED_CUSTOM_COLOR.id]);
      expect(options.map(option => option.textContent))
        .toEqual(['notAssigned', 'colorYellow', 'customColor 1', 'Ocean']);
    });

    it('preselects the color already mapped to a slot', async () => {
      respondToBackground({
        getShortcutColorMap: { success: true, shortcutColorMap: { command_slot_2: NAMED_CUSTOM_COLOR.id } },
      });
      await openSettings();

      expect(shortcutRows()[1].querySelector('select').value).toBe(NAMED_CUSTOM_COLOR.id);
    });

    it('saves the map when a slot is pointed at another color', async () => {
      await openSettings();

      const select = shortcutRows()[0].querySelector('select');
      select.value = CUSTOM_COLOR.id;
      select.dispatchEvent(new Event('change'));
      await flush();

      expect(lastMessage('saveShortcutColorMap').shortcutColorMap)
        .toMatchObject({ command_slot_1: CUSTOM_COLOR.id });
    });

    it('clears a slot pointed at a color that no longer exists', async () => {
      respondToBackground({
        getShortcutColorMap: { success: true, shortcutColorMap: { command_slot_1: 'custom_gone' } },
      });
      await openSettings();

      expect(lastMessage('saveShortcutColorMap').shortcutColorMap)
        .toMatchObject({ command_slot_1: null });
      expect(shortcutRows()[0].querySelector('select').value).toBe('');
    });

    it('hides the section where commands is unavailable', async () => {
      await withoutBrowserApi('commands', async () => {
        await openSettings();

        expect(byId('shortcuts-section').style.display).toBe('none');
        expect(shortcutRows()).toHaveLength(0);
      });
    });
  });

  // ===================================================================
  // Cloud sync
  // ===================================================================

  describe('cloud sync', () => {
    function connected(status = {}) {
      return { success: true, code: SYNC_CODE, enabled: true, ...status };
    }

    it('offers setup while no code is paired', async () => {
      await openSettings();

      expect(byId('cloud-sync-setup').style.display).toBe('');
      expect(byId('cloud-sync-connected').style.display).toBe('none');
    });

    it('shows the connected view once a code exists', async () => {
      respondToBackground({ getCloudSyncStatus: connected() });
      await openSettings();

      expect(byId('cloud-sync-setup').style.display).toBe('none');
      expect(byId('cloud-sync-connected').style.display).toBe('');
      expect(byId('cloud-sync-toggle').checked).toBe(true);
    });

    it('masks all but the first and last group of the code', async () => {
      respondToBackground({ getCloudSyncStatus: connected() });
      await openSettings();

      expect(byId('cloud-sync-code-display').textContent).toBe('ABCD-••••-IJKL');
    });

    it('reveals the code on request, and hides it again', async () => {
      respondToBackground({ getCloudSyncStatus: connected() });
      await openSettings();
      const reveal = byId('cloud-sync-toggle-visibility-btn');

      reveal.click();
      expect(byId('cloud-sync-code-display').textContent).toBe(SYNC_CODE);

      reveal.click();
      expect(byId('cloud-sync-code-display').textContent).toBe('ABCD-••••-IJKL');
    });

    it('generates a code and switches to the connected view', async () => {
      await openSettings();
      respondToBackground({
        enableCloudSync: { success: true },
        getCloudSyncStatus: connected(),
      });

      byId('cloud-sync-generate-btn').click();
      await flush();

      expect(backgroundMessages('enableCloudSync')).toHaveLength(1);
      expect(byId('cloud-sync-connected').style.display).toBe('');
    });

    it('pairs with a typed code and clears the field', async () => {
      await openSettings();
      respondToBackground({
        pairCloudSync: { success: true },
        getCloudSyncStatus: connected(),
      });

      byId('cloud-sync-pair-input').value = `  ${SYNC_CODE}  `;
      byId('cloud-sync-pair-btn').click();
      await flush();

      expect(lastMessage('pairCloudSync')).toEqual({ action: 'pairCloudSync', code: SYNC_CODE });
      expect(byId('cloud-sync-pair-input').value).toBe('');
    });

    it('ignores a pair request with an empty field', async () => {
      await openSettings();

      byId('cloud-sync-pair-input').value = '   ';
      byId('cloud-sync-pair-btn').click();
      await flush();

      expect(backgroundMessages('pairCloudSync')).toHaveLength(0);
    });

    it('warns and keeps the typed code when pairing is rejected', async () => {
      await openSettings();
      respondToBackground({ pairCloudSync: { success: false } });

      byId('cloud-sync-pair-input').value = 'WRON-GCOD-EEEE';
      byId('cloud-sync-pair-btn').click();
      await flush();

      expect(alertText()).toBe('cloudSyncInvalidCode');
      expect(byId('cloud-sync-pair-input').value).toBe('WRON-GCOD-EEEE');
    });

    it('disconnects when the toggle is switched off', async () => {
      respondToBackground({ getCloudSyncStatus: connected() });
      await openSettings();

      const toggle = byId('cloud-sync-toggle');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change'));
      await flush();

      expect(backgroundMessages('disableCloudSync')).toHaveLength(1);
    });

    it('re-pairs the stored code when the toggle is switched back on', async () => {
      respondToBackground({ getCloudSyncStatus: connected({ enabled: false }) });
      await openSettings();

      const toggle = byId('cloud-sync-toggle');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change'));
      await flush();

      expect(lastMessage('pairCloudSync')).toEqual({ action: 'pairCloudSync', code: SYNC_CODE });
    });

    it('runs a sync on request', async () => {
      respondToBackground({ getCloudSyncStatus: connected() });
      await openSettings();

      byId('cloud-sync-now-btn').click();
      await flush();

      expect(backgroundMessages('triggerCloudSync')).toHaveLength(1);
      expect(byId('cloud-sync-now-btn').disabled).toBe(false);
    });

    it('resets the code only after the confirmation is accepted', async () => {
      respondToBackground({ getCloudSyncStatus: connected() });
      await openSettings();

      byId('cloud-sync-reset-btn').click();
      await confirmModal(true);

      expect(backgroundMessages('resetCloudSyncCode')).toHaveLength(1);
    });

    it('keeps the code when the reset confirmation is cancelled', async () => {
      respondToBackground({ getCloudSyncStatus: connected() });
      await openSettings();

      byId('cloud-sync-reset-btn').click();
      await confirmModal(false);

      expect(backgroundMessages('resetCloudSyncCode')).toHaveLength(0);
    });

    it('reports a sync error in the status line', async () => {
      respondToBackground({ getCloudSyncStatus: connected({ lastError: 'quota exceeded' }) });
      await openSettings();

      const status = byId('cloud-sync-status-text');
      expect(status.textContent).toContain('quota exceeded');
      expect(status.classList.contains('cloud-sync-error-text')).toBe(true);
    });

    it('says nothing has synced yet when there is no timestamp', async () => {
      respondToBackground({ getCloudSyncStatus: connected() });
      await openSettings();

      expect(byId('cloud-sync-status-text').textContent).toBe('cloudSyncNeverSynced');
    });

    it('notes how many pages the size limit left out', async () => {
      respondToBackground({
        getCloudSyncStatus: connected({
          lastSyncedAt: '2026-06-01T00:00:00.000Z',
          lastTrimmedCount: 3,
        }),
      });
      await openSettings();

      expect(byId('cloud-sync-status-text').textContent)
        .toContain('cloudSyncPagesExcludedNotice');
    });
  });

  // ===================================================================
  // Refresh on focus
  // ===================================================================

  // Every test in this file opens the page again, and each open leaves another
  // focus listener on the shared window - so the absolute counts here are the
  // number of opens so far, not one. The shape of a single reload still shows in
  // their ratio: one colour map and one sync status per listener, and two colour
  // reads, since the shortcut list fetches them again for its dropdowns.
  it('reloads colors, shortcuts and sync status when the window regains focus', async () => {
    await openSettings();
    jest.clearAllMocks();
    respondToBackground({});

    window.dispatchEvent(new Event('focus'));
    await flush();

    const reloads = backgroundMessages('getShortcutColorMap').length;
    expect(reloads).toBeGreaterThan(0);
    expect(backgroundMessages('getCloudSyncStatus')).toHaveLength(reloads);
    expect(backgroundMessages('getColors')).toHaveLength(reloads * 2);
  });
});
