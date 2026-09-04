import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import {
  loadContentScripts,
  respondToBackground,
  resetContentScriptEnvironment,
} from './helpers/content-script.js';

// The selection bar carries a '+' like the highlight bar does. What makes that
// possible is that the selection the bar will paint is a stored Range, not the
// live selection: the picker keeps the browser away from the live one, and
// while the picker is open nothing throws the stored one away.
describe('selection bar add-colour button', () => {
  const api = {
    highlightSelection: jest.fn(),
    removeHighlightByElement: jest.fn(),
    changeHighlightColor: jest.fn(),
    refreshColors: jest.fn(),
  };
  const defaultColors = [
    { color: '#ffff00', nameKey: 'yellow' },
    { color: '#aaffaa', nameKey: 'green' },
  ];
  let selectionTextAtHighlight = null;

  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  beforeAll(async () => {
    resetContentScriptEnvironment();
    respondToBackground(message => {
      if (message.action === 'getPlatformInfo') return { isMobile: false };
      if (message.action === 'addColor') {
        return { colors: [...defaultColors, { color: message.color, id: 'custom_1', colorNumber: 1 }] };
      }
      return {};
    });
    chrome.storage.local.get.mockResolvedValue({ selectionControlsVisible: true });
    chrome.i18n.getMessage.mockImplementation(() => '');

    // jsdom does no layout; the icon placement only needs a box to read.
    window.Range.prototype.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20,
    });

    window.currentColors = defaultColors.slice();
    window.TextHighlighterContentAPI = api;
    api.highlightSelection.mockImplementation(() => {
      selectionTextAtHighlight = window.getSelection().toString();
    });

    loadContentScripts(['common', 'controls']);
    // The enabled flag lands after two awaited round trips.
    await wait(0);
  });

  afterAll(() => {
    resetContentScriptEnvironment();
  });

  function selectionControls() {
    return document.querySelector('.text-highlighter-selection-controls');
  }

  function picker() {
    return document.querySelector('.custom-color-picker');
  }

  async function openSelectionBarOver(text) {
    document.body.innerHTML = `<p id="para">${text}</p>`;
    const paragraph = document.getElementById('para');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 40, clientY: 40 }));
    // The icon appears on a 10 ms timer.
    await wait(20);
    const icon = document.querySelector('.text-highlighter-selection-icon');
    expect(icon).not.toBeNull();
    icon.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 40 }));
    expect(selectionControls()).not.toBeNull();
  }

  it('ends the selection bar with a live + button', async () => {
    await openSelectionBarOver('sample paragraph');

    const bar = selectionControls();
    expect(bar.querySelector('.delete-highlight')).toBeNull();
    expect(bar.lastElementChild.classList.contains('add-color-button')).toBe(true);

    bar.querySelector('.add-color-button').click();
    expect(picker()).not.toBeNull();
  });

  it('keeps the browser off the selection when the picker or + is pressed', () => {
    const pressOn = (element) => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(pressOn(selectionControls().querySelector('.add-color-button'))).toBe(true);
    expect(pressOn(picker().querySelector('.color-picker-header'))).toBe(true);
    expect(pressOn(picker().querySelector('.saturation-value-picker'))).toBe(true);
    expect(pressOn(picker().querySelector('.color-picker-apply'))).toBe(true);
  });

  it('survives the live selection collapsing while the picker is open', async () => {
    // A touch on the picker can still collapse the live selection.
    window.getSelection().removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    // A mouseup that lands on the picker is not a new selection attempt either.
    picker().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await wait(20);

    expect(selectionControls()).not.toBeNull();
    expect(picker()).not.toBeNull();
  });

  it('adds the picked colour and paints the stored selection with it', async () => {
    picker().querySelector('[data-color="#4ECDC4"]').click();
    await wait(0);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'addColor', color: '#4ECDC4' });
    expect(api.highlightSelection).toHaveBeenCalledWith('#4ECDC4');
    expect(selectionTextAtHighlight).toBe('sample paragraph');
    expect(picker()).toBeNull();
    expect(selectionControls()).toBeNull();
    expect(document.querySelector('.text-highlighter-selection-icon')).toBeNull();
  });

  it('paints the selection before a waking background has answered', async () => {
    api.highlightSelection.mockClear();
    // A background that is still waking up: the palette write never settles.
    respondToBackground(message => {
      if (message.action === 'addColor') return new Promise(() => {});
      return {};
    });
    await openSelectionBarOver('third paragraph');
    selectionControls().querySelector('.add-color-button').click();

    picker().querySelector('[data-color="#45B7D1"]').click();

    expect(api.highlightSelection).toHaveBeenCalledWith('#45B7D1');
    expect(selectionTextAtHighlight).toBe('third paragraph');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'addColor', color: '#45B7D1' });
    expect(selectionControls()).toBeNull();
  });

  it('paints the selection even when the palette write fails', async () => {
    api.highlightSelection.mockClear();
    respondToBackground(message => {
      if (message.action === 'addColor') throw new Error('background gone');
      return {};
    });
    await openSelectionBarOver('another paragraph');
    selectionControls().querySelector('.add-color-button').click();

    picker().querySelector('[data-color="#FF6B6B"]').click();
    await wait(0);

    expect(api.highlightSelection).toHaveBeenCalledWith('#FF6B6B');
    expect(selectionTextAtHighlight).toBe('another paragraph');
    expect(selectionControls()).toBeNull();
  });
});
