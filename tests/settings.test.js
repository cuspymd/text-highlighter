import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import {
  loadPageScript,
  readPageBody,
  stubPageEnvironment,
} from './helpers/extension-page.js';
// settings.html loads these as classic scripts ahead of settings.js.
import '../content-scripts/color-core.js';
import '../content-scripts/color-picker.js';

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

    // The switch changes what pressing the selection icon does, which a short
    // label cannot say on its own. The explanation sits behind a help tip -
    // beside the label, never inside it: the i18n pass overwrites the
    // textContent of every [data-i18n] element, children and all.
    it('explains the one-click behaviour through a help tip beside the label', async () => {
      await openSettings();

      const label = byId('one-click-highlight-row').querySelector('label[for="one-click-highlight-toggle"]');
      const bubble = byId('one-click-highlight-help');

      expect(label.textContent).toBe('oneClickHighlight');
      expect(bubble.textContent).toBe('oneClickHighlightHelp');
      expect(label.contains(bubble)).toBe(false);
      expect(bubble.closest('.help-tip').getAttribute('tabindex')).toBe('0');
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
    // Hiding the defaults with no custom colour to show instead leaves them on
    // offer, which looks like a switch that does nothing unless the page says why.
    describe('hide default colors', () => {
      it('is off when nothing has been stored, with no fallback note', async () => {
        await openSettings();

        expect(byId('hide-default-colors-toggle').checked).toBe(false);
        expect(byId('hide-default-colors-fallback').hidden).toBe(true);
      });

      it('saves the preference when it is toggled', async () => {
        await openSettings();

        const toggle = byId('hide-default-colors-toggle');
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));
        await flush();

        expect(lastMessage('saveSettings')).toEqual({
          action: 'saveSettings',
          hideDefaultColors: true,
        });
      });

      it('says the defaults are still shown while there is no custom color', async () => {
        chrome.storage.local.get.mockResolvedValue({ hideDefaultColors: true });
        respondToBackground({ getColors: { success: true, colors: [BUILT_IN_COLOR] } });
        await openSettings();

        expect(byId('hide-default-colors-toggle').checked).toBe(true);
        expect(byId('hide-default-colors-fallback').hidden).toBe(false);
        expect(byId('hide-default-colors-fallback').textContent).toBe('hideDefaultColorsFallback');
      });

      it('shows the note the moment the switch is turned on with no custom color', async () => {
        respondToBackground({ getColors: { success: true, colors: [BUILT_IN_COLOR] } });
        await openSettings();

        const toggle = byId('hide-default-colors-toggle');
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));

        expect(byId('hide-default-colors-fallback').hidden).toBe(false);
      });

      it('drops the note once custom colors exist', async () => {
        chrome.storage.local.get.mockResolvedValue({ hideDefaultColors: true });
        await openSettings();

        expect(byId('hide-default-colors-fallback').hidden).toBe(true);
      });

      it('explains what is hidden through a help tip beside the label', async () => {
        await openSettings();

        const label = byId('hide-default-colors-row').querySelector('label[for="hide-default-colors-toggle"]');
        const bubble = byId('hide-default-colors-help');

        expect(label.textContent).toBe('hideDefaultColors');
        expect(bubble.textContent).toBe('hideDefaultColorsHelp');
        expect(label.contains(bubble)).toBe(false);
      });
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

    function pickerDialog() {
      return document.querySelector('.color-picker-modal');
    }

    function hexField() {
      return pickerDialog().querySelector('.color-picker-hex');
    }

    function typeHex(value) {
      hexField().value = value;
      hexField().dispatchEvent(new Event('input', { bubbles: true }));
    }

    async function applyPicker() {
      pickerDialog().querySelector('.color-picker-apply').click();
      await flush();
    }

    it('opens its own picker rather than the browser one', async () => {
      await openSettings();

      expect(document.querySelector('input[type="color"]')).toBeNull();
      byId('add-custom-color-btn').click();

      expect(pickerDialog()).not.toBeNull();
      expect(pickerDialog().querySelector('[role="dialog"]').getAttribute('aria-labelledby'))
        .toBe('color-picker-title');
      expect(pickerDialog().querySelectorAll('.color-preset').length).toBeGreaterThan(0);
      expect(pickerDialog().querySelector('.saturation-value-picker')).not.toBeNull();
    });

    it('adds the picked color and re-renders the list', async () => {
      await openSettings();
      const added = { id: 'custom_3', color: '#00e676', colorNumber: 3 };
      respondToBackground({ addColor: { success: true, colors: [...ALL_COLORS, added] } });

      byId('add-custom-color-btn').click();
      typeHex('#00E676');
      await applyPicker();

      expect(lastMessage('addColor')).toEqual({ action: 'addColor', color: '#00e676' });
      expect(pickerDialog()).toBeNull();
      expect(colorRows()).toHaveLength(3);
    });

    it('warns instead of adding when the color is already there', async () => {
      await openSettings();
      respondToBackground({ addColor: { success: true, exists: true } });

      byId('add-custom-color-btn').click();
      typeHex('ff8a80');
      await applyPicker();

      expect(alertText()).toBe('colorAlreadyExists');
      expect(colorRows()).toHaveLength(2);
    });

    it('opens on the color being edited and updates that one, not a new one', async () => {
      await openSettings();
      respondToBackground({ updateCustomColor: { success: true, colors: ALL_COLORS } });

      colorRows()[0].querySelectorAll('.btn-icon')[0].click();
      expect(hexField().value).toBe('#FF8A80');
      typeHex('#111');
      await applyPicker();

      expect(lastMessage('updateCustomColor')).toEqual({
        action: 'updateCustomColor',
        id: CUSTOM_COLOR.id,
        color: '#111111',
      });
      expect(backgroundMessages('addColor')).toHaveLength(0);
    });

    it('loads a preset for adjusting instead of adding it on the spot', async () => {
      await openSettings();
      respondToBackground({ addColor: { success: true, colors: ALL_COLORS } });

      byId('add-custom-color-btn').click();
      pickerDialog().querySelector('[data-color="#4ECDC4"]').click();
      await flush();

      expect(pickerDialog()).not.toBeNull();
      expect(hexField().value).toBe('#4ECDC4');
      expect(backgroundMessages('addColor')).toHaveLength(0);

      await applyPicker();
      expect(lastMessage('addColor')).toEqual({ action: 'addColor', color: '#4ecdc4' });
    });

    it('adds nothing when the picker is cancelled, by button, Escape or backdrop', async () => {
      await openSettings();

      byId('add-custom-color-btn').click();
      pickerDialog().querySelector('.color-picker-close').click();
      await flush();
      expect(pickerDialog()).toBeNull();

      byId('add-custom-color-btn').click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await flush();
      expect(pickerDialog()).toBeNull();

      byId('add-custom-color-btn').click();
      pickerDialog().querySelector('.modal-overlay').click();
      await flush();
      expect(pickerDialog()).toBeNull();

      expect(backgroundMessages('addColor')).toHaveLength(0);
    });

    it('marks a half-typed code and keeps the last whole one', async () => {
      await openSettings();
      respondToBackground({ addColor: { success: true, colors: ALL_COLORS } });

      byId('add-custom-color-btn').click();
      typeHex('#123456');
      typeHex('#12z');
      expect(hexField().getAttribute('aria-invalid')).toBe('true');

      // Enter does not apply a code that is not one.
      hexField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
      expect(pickerDialog()).not.toBeNull();

      // Nor does Apply, even once the field has lost focus to it.
      const apply = pickerDialog().querySelector('.color-picker-apply');
      expect(apply.disabled).toBe(true);
      hexField().dispatchEvent(new Event('blur'));
      expect(hexField().value).toBe('#12z');
      expect(apply.disabled).toBe(true);
      await applyPicker();
      expect(pickerDialog()).not.toBeNull();
      expect(lastMessage('addColor')).toBeUndefined();

      // Finishing the code lets it through.
      typeHex('#123456');
      expect(apply.disabled).toBe(false);
      hexField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
      expect(pickerDialog()).toBeNull();
      expect(lastMessage('addColor')).toEqual({ action: 'addColor', color: '#123456' });
    });

    it('holds keyboard focus inside the picker and gives it back on close', async () => {
      await openSettings();
      const addButton = byId('add-custom-color-btn');
      addButton.focus();
      addButton.click();

      const dialog = pickerDialog().querySelector('.custom-color-picker');
      expect(document.activeElement).toBe(dialog);

      const apply = pickerDialog().querySelector('.color-picker-apply');
      const cancel = pickerDialog().querySelector('.color-picker-close');
      const tab = (shiftKey = false) => document.activeElement.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));

      // Tab from the last control wraps to the first, Shift+Tab back again.
      cancel.focus();
      tab();
      expect(document.activeElement).toBe(hexField());
      tab(true);
      expect(document.activeElement).toBe(cancel);

      // A disabled Apply is skipped.
      typeHex('#12');
      expect(apply.disabled).toBe(true);
      hexField().focus();
      tab(true);
      expect(document.activeElement).toBe(cancel);

      cancel.click();
      await flush();
      expect(pickerDialog()).toBeNull();
      expect(document.activeElement).toBe(addButton);
    });

    it('opens one picker at a time', async () => {
      await openSettings();

      byId('add-custom-color-btn').click();
      byId('add-custom-color-btn').click();
      colorRows()[0].querySelectorAll('.btn-icon')[0].click();

      expect(document.querySelectorAll('.color-picker-modal')).toHaveLength(1);
      pickerDialog().querySelector('.color-picker-close').click();
      await flush();
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

    describe('reordering', () => {
      const THIRD_COLOR = { id: 'custom_3', color: '#00e676', colorNumber: 3, customName: 'Mint' };
      const THREE = [BUILT_IN_COLOR, CUSTOM_COLOR, NAMED_CUSTOM_COLOR, THIRD_COLOR];

      function moveButtons(row) {
        const [up, down] = row.querySelectorAll('.btn-move');
        return { up, down };
      }

      async function startReordering() {
        await openSettings();
        byId('reorder-custom-colors-btn').click();
      }

      // jsdom lays nothing out, so each row reports a 40px box at its current
      // place in the list - which is what the drag measures against.
      function layOutRows() {
        colorRows().forEach((row) => {
          row.getBoundingClientRect = () => {
            const index = colorRows().indexOf(row);
            return { top: index * 40, bottom: index * 40 + 40, height: 40, left: 0, right: 300, width: 300 };
          };
        });
      }

      // jsdom has no PointerEvent; a mouse event with the pointer's id stands in.
      function pointer(target, type, clientY, pointerId) {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY });
        if (pointerId !== undefined) Object.defineProperty(event, 'pointerId', { value: pointerId });
        target.dispatchEvent(event);
      }

      beforeEach(() => {
        respondToBackground({ getColors: { success: true, colors: THREE } });
      });

      // Every opened page keeps its window listeners, and one left reordering
      // skips its colour reload on focus - which later focus tests count.
      afterEach(() => {
        const cancel = byId('reorder-cancel-btn');
        if (cancel && !byId('reorder-actions').hidden) cancel.click();
      });

      it('offers reordering only once there are two colors to order', async () => {
        respondToBackground({ getColors: { success: true, colors: [BUILT_IN_COLOR, CUSTOM_COLOR] } });
        await openSettings();
        expect(byId('reorder-custom-colors-btn').hidden).toBe(true);

        respondToBackground({ getColors: { success: true, colors: THREE } });
        await openSettings();
        expect(byId('reorder-custom-colors-btn').hidden).toBe(false);
      });

      it('keeps the move controls out of the normal list', async () => {
        await openSettings();

        expect(document.querySelectorAll('#custom-colors-list .btn-move')).toHaveLength(0);
        expect(document.querySelectorAll('#custom-colors-list .drag-handle')).toHaveLength(0);
      });

      it('swaps the editing controls for moving ones while reordering', async () => {
        await startReordering();

        expect(colorRows()).toHaveLength(3);
        expect(colorRows().every(row => row.querySelectorAll('.btn-move').length === 2)).toBe(true);
        expect(colorRows().every(row => row.querySelector('.drag-handle'))).toBe(true);
        expect(document.querySelectorAll('#custom-colors-list .btn-icon')).toHaveLength(0);
        expect(byId('add-custom-color-btn').hidden).toBe(true);
        expect(byId('clear-custom-colors-btn').hidden).toBe(true);
        expect(byId('reorder-custom-colors-btn').hidden).toBe(true);
        expect(byId('reorder-hint').hidden).toBe(false);
        expect(byId('reorder-mode-label').hidden).toBe(false);
        expect(byId('reorder-actions').hidden).toBe(false);
        expect(byId('reorder-save-btn').disabled).toBe(true);
      });

      it('lets the first color only go down and the last only go up', async () => {
        await startReordering();

        const rows = colorRows();
        expect(moveButtons(rows[0]).up.disabled).toBe(true);
        expect(moveButtons(rows[0]).down.disabled).toBe(false);
        expect(moveButtons(rows[2]).up.disabled).toBe(false);
        expect(moveButtons(rows[2]).down.disabled).toBe(true);
      });

      it('names the color in the arrow labels', async () => {
        await startReordering();

        expect(chrome.i18n.getMessage).toHaveBeenCalledWith('moveColorUp', ['Ocean']);
        expect(moveButtons(colorRows()[1]).up.getAttribute('aria-label')).toBe('moveColorUp');
      });

      it('moves colors in the draft without saving anything', async () => {
        await startReordering();

        moveButtons(colorRows()[0]).down.click();
        moveButtons(colorRows()[1]).down.click();
        await flush();

        expect(colorNames()).toEqual(['Ocean', 'Mint', 'customColor 1']);
        expect(backgroundMessages('reorderCustomColors')).toHaveLength(0);
        expect(byId('reorder-save-btn').disabled).toBe(false);
      });

      it('has nothing to save once the colors are back where they were', async () => {
        await startReordering();

        moveButtons(colorRows()[0]).down.click();
        moveButtons(colorRows()[1]).up.click();

        expect(colorNames()).toEqual(['customColor 1', 'Ocean', 'Mint']);
        expect(byId('reorder-save-btn').disabled).toBe(true);
      });

      it('keeps focus on the moved color, switching arrows at the end of the list', async () => {
        await startReordering();

        moveButtons(colorRows()[1]).down.click();

        const moved = colorRows()[2];
        expect(moved.querySelector('.color-name').textContent).toBe('Ocean');
        expect(document.activeElement).toBe(moveButtons(moved).up);
      });

      it('moves a color dragged by its handle', async () => {
        await startReordering();
        layOutRows();

        const [held, second, third] = colorRows();
        const handle = held.querySelector('.drag-handle');
        pointer(handle, 'pointerdown', 20);
        expect(held.classList.contains('dragging')).toBe(true);
        expect(document.documentElement.classList.contains('color-row-dragging')).toBe(true);

        // Past the second row's middle: the held row follows, the second makes way.
        pointer(second, 'pointermove', 70);
        expect(held.style.transform).toBe('translateY(50px)');
        expect(second.style.transform).toBe('translateY(-40px)');
        expect(third.style.transform).toBe('');

        // Far below the list: the row stops at the bottom, and both make way.
        pointer(third, 'pointermove', 400);
        expect(held.style.transform).toBe('translateY(80px)');
        expect(third.style.transform).toBe('translateY(-40px)');

        // The pointer is over another row by now; the release still ends the drag.
        pointer(third, 'pointerup', 400);
        expect(colorRows()[0]).toBe(held); // still settling into place
        await new Promise(resolve => setTimeout(resolve, 200));

        expect(colorNames()).toEqual(['Ocean', 'Mint', 'customColor 1']);
        expect(document.querySelector('.dragging')).toBeNull();
        expect(document.documentElement.classList.contains('color-row-dragging')).toBe(false);
        expect(moveButtons(colorRows()[2]).down.disabled).toBe(true);
        expect(byId('reorder-save-btn').disabled).toBe(false);
        expect(backgroundMessages('reorderCustomColors')).toHaveLength(0);
      });

      // A release outside the window never reaches the document; the capture is
      // what delivers it, and losing the capture has to end the drag too.
      it('captures the pointer and ends the drag if the capture is lost', async () => {
        await startReordering();
        layOutRows();

        const [held, second] = colorRows();
        const handle = held.querySelector('.drag-handle');
        handle.setPointerCapture = jest.fn();
        pointer(handle, 'pointerdown', 20, 7);
        expect(handle.setPointerCapture).toHaveBeenCalledWith(7);

        pointer(second, 'pointermove', 70, 7);
        pointer(handle, 'lostpointercapture', 70, 7);
        await new Promise(resolve => setTimeout(resolve, 200));

        expect(colorNames()).toEqual(['Ocean', 'customColor 1', 'Mint']);
        expect(document.querySelector('.dragging')).toBeNull();

        // The drag is over: a later release elsewhere does nothing more.
        pointer(document.body, 'pointerup', 400, 7);
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(colorNames()).toEqual(['Ocean', 'customColor 1', 'Mint']);
      });

      it('moves and drops the row only with the pointer that picked it up', async () => {
        await startReordering();
        layOutRows();

        const [held, second] = colorRows();
        const handle = held.querySelector('.drag-handle');
        pointer(handle, 'pointerdown', 20, 1);
        pointer(second, 'pointermove', 70, 1);
        expect(held.style.transform).toBe('translateY(50px)');

        // A second finger moving and lifting leaves the held row where it is.
        pointer(document.body, 'pointermove', 400, 2);
        pointer(document.body, 'pointerup', 400, 2);
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(held.style.transform).toBe('translateY(50px)');
        expect(held.classList.contains('dragging')).toBe(true);
        expect(colorRows()[0]).toBe(held);

        pointer(second, 'pointerup', 70, 1);
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(colorNames()).toEqual(['Ocean', 'customColor 1', 'Mint']);
      });

      // A second finger can reach Cancel or an arrow while the first still holds
      // a row, and the drop lands 150ms after release. Either would leave the
      // drop committing into a draft that changed or is gone.
      it('ignores Cancel and the arrows until a dragged row has landed', async () => {
        await startReordering();
        layOutRows();

        const [held, second] = colorRows();
        const handle = held.querySelector('.drag-handle');
        pointer(handle, 'pointerdown', 20, 1);
        pointer(second, 'pointermove', 70, 1);

        byId('reorder-cancel-btn').click();
        moveButtons(colorRows()[2]).up.click();
        expect(byId('reorder-actions').hidden).toBe(false);
        expect(colorRows()[0]).toBe(held);

        pointer(second, 'pointerup', 70, 1);
        byId('reorder-cancel-btn').click(); // still settling
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(byId('reorder-actions').hidden).toBe(false);
        expect(colorNames()).toEqual(['Ocean', 'customColor 1', 'Mint']);

        byId('reorder-cancel-btn').click();
        expect(byId('reorder-actions').hidden).toBe(true);
        expect(colorNames()).toEqual(['customColor 1', 'Ocean', 'Mint']);
      });

      it('saves the whole order in one message and leaves reorder mode', async () => {
        await startReordering();
        moveButtons(colorRows()[0]).down.click();
        moveButtons(colorRows()[1]).down.click();
        respondToBackground({
          reorderCustomColors: {
            success: true,
            colors: [BUILT_IN_COLOR, NAMED_CUSTOM_COLOR, THIRD_COLOR, CUSTOM_COLOR],
          },
        });

        byId('reorder-save-btn').click();
        await flush();

        expect(backgroundMessages('reorderCustomColors')).toEqual([{
          action: 'reorderCustomColors',
          ids: ['custom_2', 'custom_3', 'custom_1'],
        }]);
        expect(colorNames()).toEqual(['Ocean', 'Mint', 'customColor 1']);
        expect(document.querySelectorAll('#custom-colors-list .btn-move')).toHaveLength(0);
        expect(byId('reorder-actions').hidden).toBe(true);
        expect(byId('reorder-mode-label').hidden).toBe(true);
        expect(byId('add-custom-color-btn').hidden).toBe(false);
        expect(byId('reorder-custom-colors-btn').hidden).toBe(false);
        expect(byId('reorder-saved-status').textContent).toBe('colorOrderSaved');
      });

      it('drops the saved note when reordering starts again', async () => {
        await startReordering();
        moveButtons(colorRows()[0]).down.click();
        respondToBackground({
          reorderCustomColors: {
            success: true,
            colors: [BUILT_IN_COLOR, NAMED_CUSTOM_COLOR, CUSTOM_COLOR, THIRD_COLOR],
          },
        });
        byId('reorder-save-btn').click();
        await flush();
        expect(byId('reorder-saved-status').textContent).toBe('colorOrderSaved');

        byId('reorder-custom-colors-btn').click();

        expect(byId('reorder-saved-status').textContent).toBe('');
      });

      it('holds every reorder control still until the save is answered', async () => {
        await startReordering();
        moveButtons(colorRows()[0]).down.click();
        const answer = chrome.runtime.sendMessage.getMockImplementation();
        let finishSave;
        chrome.runtime.sendMessage.mockImplementation(message => (
          message.action === 'reorderCustomColors'
            ? new Promise((resolve) => { finishSave = resolve; })
            : answer(message)
        ));

        byId('reorder-save-btn').click();
        await flush();

        expect(colorRows().every(row => moveButtons(row).up.disabled && moveButtons(row).down.disabled))
          .toBe(true);
        expect(byId('reorder-cancel-btn').disabled).toBe(true);
        expect(byId('reorder-save-btn').disabled).toBe(true);
        pointer(colorRows()[0].querySelector('.drag-handle'), 'pointerdown', 20);
        expect(document.querySelector('.dragging')).toBeNull();
        byId('reorder-save-btn').click();
        expect(backgroundMessages('reorderCustomColors')).toHaveLength(1);

        finishSave({
          success: true,
          colors: [BUILT_IN_COLOR, NAMED_CUSTOM_COLOR, CUSTOM_COLOR, THIRD_COLOR],
        });
        await flush();

        expect(colorNames()).toEqual(['Ocean', 'customColor 1', 'Mint']);
        expect(byId('reorder-actions').hidden).toBe(true);
        expect(byId('reorder-cancel-btn').disabled).toBe(false);
      });

      it('puts the old order back on cancel without saving', async () => {
        await startReordering();
        moveButtons(colorRows()[0]).down.click();

        byId('reorder-cancel-btn').click();
        await flush();

        expect(colorNames()).toEqual(['customColor 1', 'Ocean', 'Mint']);
        expect(backgroundMessages('reorderCustomColors')).toHaveLength(0);
        expect(byId('reorder-actions').hidden).toBe(true);
        expect(byId('add-custom-color-btn').hidden).toBe(false);
      });

      it('says so and shows the current list when the colors changed elsewhere', async () => {
        await startReordering();
        moveButtons(colorRows()[0]).down.click();
        respondToBackground({
          reorderCustomColors: {
            success: true,
            mismatch: true,
            colors: [BUILT_IN_COLOR, THIRD_COLOR, CUSTOM_COLOR],
          },
        });

        byId('reorder-save-btn').click();
        await flush();

        expect(alertText()).toBe('colorOrderOutdated');
        expect(colorNames()).toEqual(['Mint', 'customColor 1']);
        expect(byId('reorder-actions').hidden).toBe(true);
        expect(byId('reorder-saved-status').textContent).toBe('');
      });

      it('keeps the draft for another try when the save fails', async () => {
        await startReordering();
        moveButtons(colorRows()[0]).down.click();
        respondToBackground({ reorderCustomColors: { success: false } });

        byId('reorder-save-btn').click();
        await flush();

        expect(colorNames()).toEqual(['Ocean', 'customColor 1', 'Mint']);
        expect(byId('reorder-actions').hidden).toBe(false);
        expect(byId('reorder-save-btn').disabled).toBe(false);
        expect(byId('reorder-cancel-btn').disabled).toBe(false);
        expect(moveButtons(colorRows()[0]).down.disabled).toBe(false);
      });

      it('does not reload the colors over the draft when the window regains focus', async () => {
        await startReordering();
        moveButtons(colorRows()[0]).down.click();

        window.dispatchEvent(new Event('focus'));
        await flush();

        expect(colorNames()).toEqual(['Ocean', 'customColor 1', 'Mint']);
        expect(colorRows()[0].querySelector('.drag-handle')).not.toBeNull();
      });

      it('asks before leaving the page with an unsaved order', async () => {
        await startReordering();
        moveButtons(colorRows()[0]).down.click();

        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
      });
    });
  });

  // ===================================================================
  // Keyboard shortcuts
  // ===================================================================

  describe('keyboard shortcuts', () => {
    it('renders a row per shortcut slot, then the two navigation shortcuts', async () => {
      await openSettings();

      expect(shortcutRows()).toHaveLength(7);
      expect(shortcutRows().filter(row => row.querySelector('select'))).toHaveLength(5);
    });

    it('lists the navigation shortcuts with their keys and no color to choose', async () => {
      chrome.commands.getAll.mockResolvedValue([
        { name: 'navigate_next_highlight', shortcut: 'Ctrl+Shift+Down' },
        { name: 'navigate_previous_highlight', shortcut: '' },
      ]);
      await openSettings();

      const rows = [...document.querySelectorAll('#shortcuts-list .shortcut-row-navigation')];
      expect(rows.map(row => row.querySelector('.shortcut-slot').textContent))
        .toEqual(['commandNextHighlight', 'commandPreviousHighlight']);
      expect(rows.map(row => row.querySelector('.key-badge').textContent))
        .toEqual(['Ctrl+Shift+Down', 'notAssigned']);
      expect(rows.some(row => row.querySelector('select'))).toBe(false);
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
