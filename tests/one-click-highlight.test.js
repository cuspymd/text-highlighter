import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import {
  loadContentScripts,
  respondToBackground,
  respondToStorage,
  resetContentScriptEnvironment,
} from './helpers/content-script.js';

// One-click highlighting is an opt-in setting: with it on, pressing the
// selection icon paints with the colour used last instead of opening the
// palette. The palette is still reachable - the highlight that press created
// opens it on a click - so nothing here may depend on hover or a long press.
describe('one-click highlighting', () => {
  const palette = [
    { id: 'yellow', nameKey: 'yellowColor', color: '#FFFF00' },
    { id: 'green', nameKey: 'greenColor', color: '#AAFFAA' },
    { id: 'custom_1', colorNumber: 1, color: '#123456' },
  ];

  let page = null;
  let storageWatcher = null;
  let originalRangeRect;

  beforeAll(async () => {
    jest.useFakeTimers();
    resetContentScriptEnvironment();

    respondToBackground(message => {
      if (message.action === 'getPlatformInfo') return { isMobile: false };
      if (message.action === 'getColors') return { colors: palette };
      if (message.action === 'getHighlights') return { highlights: [] };
      return { success: true };
    });
    // The setting and the remembered colour are read in the same round trip as
    // the selection-controls setting.
    respondToStorage({
      minimapVisible: false,
      selectionControlsVisible: true,
      oneClickHighlightEnabled: true,
      lastUsedColor: '#AAFFAA',
    });
    chrome.i18n.getMessage.mockImplementation(key => key);

    // jsdom does no layout; the icon placement only needs a box to read.
    originalRangeRect = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20,
    });

    // Each evaluated script gets its own lexical scope here, so the palette
    // content.js loads is not the one controls.js reads. In the extension they
    // share a global; in the harness that sharing is this window property.
    window.currentColors = palette.slice();
    // controls.js owns these; each script has its own scope in the harness, so
    // the ones content.js reads have to be on the window.
    window.activeHighlightElement = null;
    window.highlightControlsContainer = null;

    page = loadContentScripts(['common', 'controls', 'content']);
    await jest.advanceTimersByTimeAsync(600);

    const watcherCalls = chrome.storage.onChanged.addListener.mock.calls;
    storageWatcher = watcherCalls.length ? watcherCalls[watcherCalls.length - 1][0] : null;
  });

  afterAll(() => {
    jest.useRealTimers();
    Range.prototype.getBoundingClientRect = originalRangeRect;
    resetContentScriptEnvironment();
  });

  /** Select a fresh paragraph and let the selection raise its icon. */
  async function raiseIconOver(text) {
    // A palette bar left open from an earlier press keeps the icon from being
    // shown at all; a click outside it is what dismisses it in the page too.
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.body.innerHTML = `<p id="para">${text}</p>`;
    const paragraph = document.getElementById('para');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 40, clientY: 40 }));
    await jest.advanceTimersByTimeAsync(20);

    const icon = document.querySelector('.text-highlighter-selection-icon');
    expect(icon).not.toBeNull();
    return icon;
  }

  function iconSwatchColor() {
    const swatch = document.querySelector('.text-highlighter-selection-icon-swatch');
    return swatch ? swatch.style.backgroundColor : null;
  }

  /** Raise the icon over a fresh paragraph and press it. */
  async function selectAndPressIcon(text) {
    const icon = await raiseIconOver(text);
    const swatch = iconSwatchColor();

    icon.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 40 }));
    await jest.advanceTimersByTimeAsync(20);

    return { swatch };
  }

  function selectionBar() {
    return document.querySelector('.text-highlighter-selection-controls');
  }

  function lastSavedGroup() {
    const groups = window.TextHighlighterState.get().highlights;
    return groups[groups.length - 1] || null;
  }

  function lastRecordedColor() {
    const writes = chrome.storage.local.set.mock.calls
      .map(([items]) => items)
      .filter(items => items && items.lastUsedColor !== undefined);
    return writes.length ? writes[writes.length - 1].lastUsedColor : null;
  }

  it('paints with the remembered colour instead of opening the palette', async () => {
    const { swatch } = await selectAndPressIcon('one click paragraph');

    expect(selectionBar()).toBeNull();
    expect(lastSavedGroup().color).toBe('#AAFFAA');
    // The icon says which colour the press will use before it is pressed.
    expect(swatch).toBe('rgb(170, 255, 170)');
    expect(document.querySelector('.text-highlighter-selection-icon')).toBeNull();
  });

  it('records the colour every highlight is painted with', () => {
    expect(lastRecordedColor()).toBe('#AAFFAA');
  });

  it('records a recolour of an existing highlight as the last used colour', () => {
    const span = document.createElement('span');
    span.className = 'text-highlighter-extension';
    span.dataset.groupId = 'group-1';
    span.textContent = 'sample';
    document.body.appendChild(span);

    window.changeHighlightColor(span, '#123456');

    expect(lastRecordedColor()).toBe('#123456');
  });

  it('records the colour again even when this tab used it before', () => {
    // Another tab recorded something else in between. A write skipped because
    // this tab painted the same colour twice would leave that other value
    // standing as "the last one used".
    storageWatcher({ lastUsedColor: { newValue: '#FFFF00' } }, 'local');
    chrome.storage.local.set.mockClear();

    const span = document.querySelector('.text-highlighter-extension');
    window.changeHighlightColor(span, '#123456');

    expect(lastRecordedColor()).toBe('#123456');
  });

  it('offers the colour another tab painted with', async () => {
    expect(storageWatcher).not.toBeNull();
    storageWatcher({ lastUsedColor: { newValue: '#123456' } }, 'local');

    const { swatch } = await selectAndPressIcon('another tab paragraph');

    expect(swatch).toBe('rgb(18, 52, 86)');
    expect(lastSavedGroup().color).toBe('#123456');
  });

  it('falls back to the first palette colour when the remembered one is gone', async () => {
    // What removing a custom colour in settings leaves behind: a value that no
    // palette entry has any more.
    storageWatcher({ lastUsedColor: { newValue: '#DEAD00' } }, 'local');

    const { swatch } = await selectAndPressIcon('removed colour paragraph');

    expect(swatch).toBe('rgb(255, 255, 0)');
    expect(lastSavedGroup().color).toBe('#FFFF00');
  });

  // The icon promises a colour and an action. Both can change while it is up -
  // the setting from the settings page, the colour from another tab - and an
  // icon left as it was would promise the wrong one.
  it('redraws an icon that is already up when the setting is switched', async () => {
    await raiseIconOver('switched while up');
    expect(iconSwatchColor()).not.toBeNull();

    await page.sendToContentScript({ action: 'setOneClickHighlight', enabled: false });
    expect(iconSwatchColor()).toBeNull();

    await page.sendToContentScript({ action: 'setOneClickHighlight', enabled: true });
    expect(iconSwatchColor()).not.toBeNull();
  });

  it('redraws an icon that is already up when another tab paints', async () => {
    await raiseIconOver('recoloured while up');
    storageWatcher({ lastUsedColor: { newValue: '#AAFFAA' } }, 'local');

    expect(iconSwatchColor()).toBe('rgb(170, 255, 170)');
  });

  it('opens the palette again once the setting is turned off', async () => {
    await page.sendToContentScript({ action: 'setOneClickHighlight', enabled: false });

    document.body.innerHTML = '<p id="para">palette paragraph</p>';
    const paragraph = document.getElementById('para');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 40, clientY: 40 }));
    await jest.advanceTimersByTimeAsync(20);

    const icon = document.querySelector('.text-highlighter-selection-icon');
    expect(icon.querySelector('.text-highlighter-selection-icon-swatch')).toBeNull();

    icon.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 40 }));
    await jest.advanceTimersByTimeAsync(20);

    expect(selectionBar()).not.toBeNull();
    expect(document.querySelectorAll('.text-highlighter-extension').length).toBe(0);
  });

  it('takes the setting back up when it is turned on again', async () => {
    await page.sendToContentScript({ action: 'setOneClickHighlight', enabled: true });

    const { swatch } = await selectAndPressIcon('back on paragraph');

    expect(swatch).toBe('rgb(170, 255, 170)');
    expect(selectionBar()).toBeNull();
  });
});
