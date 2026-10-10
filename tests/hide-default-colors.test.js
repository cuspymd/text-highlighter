import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import {
  loadContentScripts,
  respondToBackground,
  respondToStorage,
  resetContentScriptEnvironment,
} from './helpers/content-script.js';

// "Hide default colors" narrows what the colour strips offer to the custom
// colours. It is only the offer: currentColors keeps the defaults, and a palette
// with no custom colours keeps showing them so there is something to pick.
describe('hiding the default colours in the page', () => {
  const defaults = [
    { id: 'yellow', nameKey: 'yellowColor', color: '#FFFF00' },
    { id: 'green', nameKey: 'greenColor', color: '#AAFFAA' },
    { id: 'blue', nameKey: 'blueColor', color: '#AAAAFF' },
    { id: 'pink', nameKey: 'pinkColor', color: '#FFAAFF' },
    { id: 'orange', nameKey: 'orangeColor', color: '#FFAA55' },
  ];
  const customs = [
    { id: 'custom_1', colorNumber: 1, color: '#123456' },
    { id: 'custom_2', colorNumber: 2, color: '#654321' },
  ];
  const palette = [...defaults, ...customs];

  let page = null;
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
    // The setting is read in the same round trip as the selection-controls one.
    respondToStorage({
      minimapVisible: false,
      selectionControlsVisible: true,
      oneClickHighlightEnabled: false,
      hideDefaultColors: true,
    });
    chrome.i18n.getMessage.mockImplementation(key => key);

    originalRangeRect = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20,
    });

    // Each evaluated script has its own scope in the harness; in the extension
    // they share these globals.
    window.currentColors = palette.slice();
    window.activeHighlightElement = null;
    window.highlightControlsContainer = null;

    page = loadContentScripts(['common', 'controls', 'content']);
    await jest.advanceTimersByTimeAsync(600);
  });

  afterAll(() => {
    jest.useRealTimers();
    Range.prototype.getBoundingClientRect = originalRangeRect;
    resetContentScriptEnvironment();
  });

  function stripColors(container) {
    return Array.from(container.querySelectorAll('.text-highlighter-color-buttons .color-button'))
      .map(button => button.style.backgroundColor);
  }

  function highlightBar() {
    if (!document.querySelector('.text-highlighter-controls:not(.text-highlighter-selection-controls)')) {
      window.createHighlightControls();
    }
    return document.querySelector('.text-highlighter-controls:not(.text-highlighter-selection-controls)');
  }

  async function openSelectionBar(text) {
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.body.querySelectorAll('p').forEach(p => p.remove());
    const paragraph = document.createElement('p');
    paragraph.id = 'para';
    paragraph.textContent = text;
    document.body.appendChild(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 40, clientY: 40 }));
    await jest.advanceTimersByTimeAsync(20);
    const icon = document.querySelector('.text-highlighter-selection-icon');
    icon.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 40 }));
    // Past the guard that ignores the click which opened the bar.
    await jest.advanceTimersByTimeAsync(400);
    return document.querySelector('.text-highlighter-selection-controls');
  }

  // What a colorsUpdated broadcast does in the extension. The harness gives
  // content.js its own copy of the palette, so the one controls.js reads is set
  // on the window directly.
  function receivePalette(colors) {
    window.currentColors = colors;
    window.refreshHighlightControlsColors();
  }

  function lastSavedGroup() {
    const groups = window.TextHighlighterState.get().highlights;
    return groups[groups.length - 1] || null;
  }

  it('offers only the custom colours, with no separator, once the stored setting loads', () => {
    const bar = highlightBar();

    expect(stripColors(bar)).toEqual(['rgb(18, 52, 86)', 'rgb(101, 67, 33)']);
    expect(bar.querySelectorAll('.color-separator')).toHaveLength(0);
  });

  it('paints the selection with the custom colour that was clicked', async () => {
    const bar = await openSelectionBar('hidden defaults paragraph');
    expect(stripColors(bar)).toEqual(['rgb(18, 52, 86)', 'rgb(101, 67, 33)']);

    bar.querySelectorAll('.color-button')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(lastSavedGroup().color).toBe('#654321');
  });

  // Nothing redraws an open selection palette, so a palette change while one is
  // up leaves its buttons as they were drawn. Each must still paint with the
  // colour it shows, not with whatever now sits at its position.
  it('paints with the colour shown when the palette changes while it is open', async () => {
    const bar = await openSelectionBar('changed while open paragraph');
    expect(stripColors(bar)).toEqual(['rgb(18, 52, 86)', 'rgb(101, 67, 33)']);

    // The defaults come back while the bar is up; position 0 is now yellow.
    await page.sendToContentScript({ action: 'setHideDefaultColors', hidden: false });
    bar.querySelectorAll('.color-button')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(lastSavedGroup().color).toBe('#123456');
    await page.sendToContentScript({ action: 'setHideDefaultColors', hidden: true });
  });

  it('keeps showing the defaults while there is no custom colour', () => {
    receivePalette(defaults.slice());

    expect(stripColors(highlightBar())).toHaveLength(5);
  });

  it('hides the defaults as soon as the first custom colour arrives', () => {
    receivePalette([...defaults, customs[0]]);

    expect(stripColors(highlightBar())).toEqual(['rgb(18, 52, 86)']);
  });

  it('brings the defaults back, behind a separator, when the setting is turned off', async () => {
    receivePalette(palette.slice());
    await page.sendToContentScript({ action: 'setHideDefaultColors', hidden: false });

    const bar = highlightBar();
    expect(stripColors(bar)).toHaveLength(7);
    expect(bar.querySelectorAll('.color-separator')).toHaveLength(1);
  });

  it('leaves the full palette in place for everything else to look colours up in', async () => {
    await page.sendToContentScript({ action: 'setHideDefaultColors', hidden: true });

    expect(window.currentColors).toHaveLength(7);
    expect(stripColors(highlightBar())).toHaveLength(2);
  });
});
