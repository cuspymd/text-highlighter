import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import {
  loadContentScripts,
  respondToBackground,
  resetContentScriptEnvironment,
} from './helpers/content-script.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Firefox for Android has no toolbar button to pin, so the pages behind the
// popup are four taps or more away. On mobile the bar's trailing button is a
// more menu that reaches them - and holds '+', which moved into it.
describe('controls more menu (mobile)', () => {
  const api = {
    highlightSelection: jest.fn(),
    removeHighlightByElement: jest.fn(),
    changeHighlightColor: jest.fn(),
    refreshColors: jest.fn(),
  };

  beforeAll(async () => {
    resetContentScriptEnvironment();
    respondToBackground(message =>
      (message.action === 'getPlatformInfo' ? { isMobile: true } : { success: true })
    );
    chrome.storage.local.get.mockResolvedValue({});
    chrome.i18n.getMessage.mockImplementation(key => key);

    window.currentColors = [
      { color: '#ffff00', nameKey: 'yellow' },
      { color: '#aaffaa', nameKey: 'green' },
      { color: '#aaaaff', nameKey: 'blue' },
      { color: '#ffaaff', nameKey: 'pink' },
      { color: '#ffd8a8', nameKey: 'orange' },
    ];
    window.TextHighlighterContentAPI = api;

    loadContentScripts(['common', 'controls']);
    // The platform answer is a promise; the bar has to be built after it lands.
    await wait(0);
  });

  afterAll(() => {
    resetContentScriptEnvironment();
  });

  beforeEach(async () => {
    window.hideMoreMenu();
    chrome.runtime.sendMessage.mockClear();
    const span = document.createElement('span');
    span.className = 'text-highlighter-extension';
    document.body.appendChild(span);
    window.showControlUi(span, { clientX: 20, clientY: 20 });
    // The bar becomes visible on a 10 ms timer.
    await wait(20);
  });

  function bar() {
    return document.querySelector('.text-highlighter-controls:not(.text-highlighter-selection-controls)');
  }

  function menu() {
    return document.querySelector('.text-highlighter-more-menu');
  }

  function menuItem(labelKey) {
    return Array.from(document.querySelectorAll('.text-highlighter-more-menu-item'))
      .find(item => item.textContent === labelKey);
  }

  async function openMenu(container = bar()) {
    container.querySelector('.text-highlighter-more-button').click();
    // The outside-click handler is registered on a 10 ms timer.
    await wait(20);
  }

  it('puts a vertical more button where + was, outside the colour strip', () => {
    const children = Array.from(bar().children).map(el => el.className);

    expect(children).toEqual([
      'text-highlighter-control-button delete-highlight',
      'text-highlighter-color-scroll',
      'text-highlighter-control-button text-highlighter-more-button',
    ]);
    expect(bar().querySelector('.add-color-button')).toBeNull();

    const dots = Array.from(bar().querySelectorAll('.text-highlighter-more-button svg circle'));
    expect(dots).toHaveLength(3);
    expect(new Set(dots.map(dot => dot.getAttribute('cx'))).size).toBe(1);
    expect(new Set(dots.map(dot => dot.getAttribute('cy'))).size).toBe(3);
  });

  it('opens a menu with add colour, the pages list and settings', async () => {
    await openMenu();

    const labels = Array.from(menu().querySelectorAll('.text-highlighter-more-menu-item'))
      .map(item => item.textContent);
    expect(labels).toEqual(['addColor', 'viewAllPages', 'settingsTitle']);
    expect(bar().querySelector('.text-highlighter-more-button').getAttribute('aria-expanded')).toBe('true');
  });

  it.each([
    ['viewAllPages', 'pagesList'],
    ['settingsTitle', 'settings'],
  ])('asks the background to open %s, closing the menu but not the bar', async (labelKey, page) => {
    await openMenu();

    menuItem(labelKey).click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'openExtensionPage', page });
    expect(menu()).toBeNull();
    expect(bar().classList.contains('visible')).toBe(true);
    expect(bar().querySelector('.text-highlighter-more-button').getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the colour picker from the add colour item', async () => {
    await openMenu();

    menuItem('addColor').click();

    expect(menu()).toBeNull();
    const picker = document.querySelector('.custom-color-picker');
    expect(picker).not.toBeNull();
    expect(bar().classList.contains('visible')).toBe(true);

    picker.querySelector('.color-picker-close').click();
    expect(document.querySelector('.custom-color-picker')).toBeNull();
  });

  it('closes on a tap outside it, and toggles from the more button', async () => {
    await openMenu();
    bar().querySelector('.text-highlighter-more-button').click();
    expect(menu()).toBeNull();

    await openMenu();
    document.body.click();
    expect(menu()).toBeNull();
  });

  it('closes with the bar it belongs to', async () => {
    await openMenu();

    window.hideHighlightControls();

    expect(menu()).toBeNull();
  });

  it('gives the selection bar a more menu whose colour paints the selection', async () => {
    window.hideHighlightControls();
    // jsdom does no layout; the icon placement only needs a box to read.
    window.Range.prototype.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20,
    });
    const paragraph = document.createElement('p');
    paragraph.textContent = 'some words to highlight';
    document.body.appendChild(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 40, clientY: 40 }));
    // The icon appears on a 10 ms timer.
    await wait(20);
    document.querySelector('.text-highlighter-selection-icon')
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 40 }));

    const selectionBar = document.querySelector('.text-highlighter-selection-controls');
    expect(selectionBar.lastElementChild.classList.contains('text-highlighter-more-button')).toBe(true);
    expect(selectionBar.querySelector('.add-color-button')).toBeNull();

    // A press within the ghost-click window is taken for the icon's own press.
    selectionBar.querySelector('.text-highlighter-more-button').click();
    expect(menu()).toBeNull();
    await wait(310);

    await openMenu(selectionBar);
    menuItem('addColor').click();
    document.querySelector('.custom-color-picker .color-preset').click();

    expect(api.highlightSelection).toHaveBeenCalledWith('#FF6B6B');
  });
});
