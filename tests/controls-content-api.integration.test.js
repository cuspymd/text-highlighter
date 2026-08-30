import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import {
  loadContentScripts,
  respondToBackground,
  resetContentScriptEnvironment,
} from './helpers/content-script.js';

describe('controls -> content API integration', () => {
  const api = {
    highlightSelection: jest.fn(),
    removeHighlightByElement: jest.fn(),
    changeHighlightColor: jest.fn(),
    refreshColors: jest.fn(),
  };

  beforeAll(async () => {
    resetContentScriptEnvironment();

    respondToBackground(message =>
      (message.action === 'getPlatformInfo' ? { isMobile: false } : {})
    );
    chrome.storage.local.get.mockResolvedValue({ selectionControlsVisible: true });
    chrome.i18n.getMessage.mockImplementation(() => '');

    // Both are read by controls.js as it builds the UI, so they have to be in
    // place before it is evaluated.
    window.currentColors = [
      { color: '#ffff00', nameKey: 'yellow' },
      { color: '#aaffaa', nameKey: 'green' },
    ];
    window.TextHighlighterContentAPI = api;

    loadContentScripts(['common', 'controls']);
    window.createHighlightControls();
  });

  afterAll(() => {
    resetContentScriptEnvironment();
  });

  beforeEach(() => {
    api.highlightSelection.mockClear();
    api.removeHighlightByElement.mockClear();
    api.changeHighlightColor.mockClear();
  });

  function flush() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  function addHighlightSpan(groupId) {
    const span = document.createElement('span');
    span.className = 'text-highlighter-extension';
    span.dataset.groupId = groupId;
    span.textContent = 'sample';
    document.body.appendChild(span);
    return span;
  }

  it('calls removeHighlightByElement via TextHighlighterContentAPI on delete button click', () => {
    const span = addHighlightSpan('g1');

    window.showControlUi(span, { clientX: 10, clientY: 10 });
    document.querySelector('.delete-highlight').click();

    expect(api.removeHighlightByElement).toHaveBeenCalledWith(span);
  });

  it('calls changeHighlightColor via TextHighlighterContentAPI on color button click', () => {
    const span = addHighlightSpan('g2');

    window.showControlUi(span, { clientX: 20, clientY: 20 });
    document.querySelector('.text-highlighter-color-buttons .color-button').click();

    expect(api.changeHighlightColor).toHaveBeenCalledWith(span, '#ffff00');
  });

  it('positions highlight controls slightly above the click point', () => {
    const span = addHighlightSpan('g3');

    window.showControlUi(span, { clientX: 100, clientY: 100 });

    expect(document.querySelector('.text-highlighter-controls').style.top).toBe('48px');
  });

  // Last, because the mobile flag it sets stays set for the rest of the file.
  it('anchors mobile highlight controls to the highlight rect instead of the touch point', async () => {
    const span = addHighlightSpan('g4');

    span.getBoundingClientRect = jest.fn(() => ({
      top: 120,
      bottom: 140,
      left: 40,
      right: 160,
      width: 120,
      height: 20,
    }));

    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    respondToBackground(message =>
      (message.action === 'getPlatformInfo' ? { isMobile: true } : {})
    );

    // The platform answer now arrives as a promise, so the detection has to
    // land before the controls are positioned.
    window.initializeSelectionControls();
    await flush();

    window.showControlUi(span, { clientX: 120, clientY: 700 });

    expect(document.querySelector('.text-highlighter-controls').style.top).toBe('68px');

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
  });
});
