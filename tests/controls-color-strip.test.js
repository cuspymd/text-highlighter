import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import {
  loadContentScripts,
  respondToBackground,
  resetContentScriptEnvironment,
} from './helpers/content-script.js';

// The colour buttons live in a horizontally scrollable strip so the bar never
// grows past a narrow viewport. jsdom does no layout, so the strip's metrics
// are stubbed to stand for "overflowing" and "fits".
describe('controls colour strip', () => {
  const api = {
    highlightSelection: jest.fn(),
    removeHighlightByElement: jest.fn(),
    changeHighlightColor: jest.fn(),
    refreshColors: jest.fn(),
  };

  beforeAll(() => {
    resetContentScriptEnvironment();
    respondToBackground(message =>
      (message.action === 'getPlatformInfo' ? { isMobile: false } : {})
    );
    chrome.storage.local.get.mockResolvedValue({ selectionControlsVisible: true });
    chrome.i18n.getMessage.mockImplementation(() => '');

    window.currentColors = [
      { color: '#ffff00', nameKey: 'yellow' },
      { color: '#aaffaa', nameKey: 'green' },
      { color: '#aaaaff', nameKey: 'blue' },
      { color: '#ffaaff', nameKey: 'pink' },
      { color: '#ffd8a8', nameKey: 'orange' },
      { color: '#ff6b6b', id: 'custom_1', colorNumber: 1 },
      { color: '#4ecdc4', id: 'custom_2', colorNumber: 2 },
    ];
    window.TextHighlighterContentAPI = api;

    loadContentScripts(['common', 'controls']);
    window.createHighlightControls();
  });

  afterAll(() => {
    resetContentScriptEnvironment();
  });

  function controls() {
    return document.querySelector('.text-highlighter-controls');
  }

  function strip(container = controls()) {
    return container.querySelector('.text-highlighter-color-buttons');
  }

  function stubMetrics(element, { scrollWidth, clientWidth, scrollLeft }) {
    Object.defineProperty(element, 'scrollWidth', { configurable: true, value: scrollWidth });
    Object.defineProperty(element, 'clientWidth', { configurable: true, value: clientWidth });
    Object.defineProperty(element, 'scrollLeft', { configurable: true, writable: true, value: scrollLeft });
  }

  it('keeps the delete and + buttons outside the scrollable strip', () => {
    const container = controls();
    const children = Array.from(container.children).map(el => el.className);

    expect(children).toEqual([
      'text-highlighter-control-button delete-highlight',
      'text-highlighter-color-scroll',
      'text-highlighter-control-button add-color-button',
    ]);
    expect(strip().parentElement.className).toBe('text-highlighter-color-scroll');
    expect(strip().querySelector('.add-color-button')).toBeNull();
    expect(strip().querySelectorAll('.color-button')).toHaveLength(7);
    expect(strip().querySelectorAll('.color-separator')).toHaveLength(1);
  });

  it('shows no hints and keeps touch gestures when the strip fits', () => {
    stubMetrics(strip(), { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });

    window.updateColorScrollHints(controls());

    expect(strip().classList.contains('is-scrollable')).toBe(false);
    expect(strip().parentElement.classList.contains('can-scroll-left')).toBe(false);
    expect(strip().parentElement.classList.contains('can-scroll-right')).toBe(false);
  });

  it('marks the strip scrollable and fades the side with hidden colours', () => {
    const wrapper = strip().parentElement;

    stubMetrics(strip(), { scrollWidth: 400, clientWidth: 220, scrollLeft: 0 });
    window.updateColorScrollHints(controls());
    expect(strip().classList.contains('is-scrollable')).toBe(true);
    expect(wrapper.classList.contains('can-scroll-left')).toBe(false);
    expect(wrapper.classList.contains('can-scroll-right')).toBe(true);

    strip().scrollLeft = 90;
    strip().dispatchEvent(new Event('scroll'));
    expect(wrapper.classList.contains('can-scroll-left')).toBe(true);
    expect(wrapper.classList.contains('can-scroll-right')).toBe(true);

    strip().scrollLeft = 180;
    strip().dispatchEvent(new Event('scroll'));
    expect(wrapper.classList.contains('can-scroll-left')).toBe(true);
    expect(wrapper.classList.contains('can-scroll-right')).toBe(false);
  });

  it('rebuilds only the strip when the colours change, leaving + in place', () => {
    window.currentColors = window.currentColors.slice(0, 5);

    window.refreshHighlightControlsColors();

    expect(strip().querySelectorAll('.color-button')).toHaveLength(5);
    expect(strip().querySelectorAll('.color-separator')).toHaveLength(0);
    expect(controls().querySelectorAll('.add-color-button')).toHaveLength(1);
    expect(controls().lastElementChild.classList.contains('add-color-button')).toBe(true);
  });

  it('resets the strip to its start each time the bar is shown', () => {
    const span = document.createElement('span');
    span.className = 'text-highlighter-extension';
    document.body.appendChild(span);
    stubMetrics(strip(), { scrollWidth: 400, clientWidth: 220, scrollLeft: 150 });

    window.showControlUi(span, { clientX: 20, clientY: 20 });

    expect(strip().scrollLeft).toBe(0);
  });
});
