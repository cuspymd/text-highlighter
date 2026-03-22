import fs from 'fs';

const commonSource = fs.readFileSync(new URL('../content-scripts/content-common.js', import.meta.url), 'utf8');
const controlsSource = fs.readFileSync(new URL('../content-scripts/controls.js', import.meta.url), 'utf8');

describe('controls -> content API integration', () => {
  const api = {
    highlightSelection: jest.fn(),
    removeHighlightByElement: jest.fn(),
    changeHighlightColor: jest.fn(),
    refreshColors: jest.fn(),
  };

  beforeAll(() => {
    window.currentColors = [
      { color: '#ffff00', nameKey: 'yellow' },
      { color: '#aaffaa', nameKey: 'green' },
    ];
    window.debugLog = () => {};
    window.TextHighlighterContentAPI = api;

    global.browser = {
      runtime: {
        sendMessage: jest.fn((message, callback) => {
          if (!callback) return;
          if (message.action === 'getPlatformInfo') {
            callback({ isMobile: false });
            return;
          }
          callback({});
        }),
        getURL: jest.fn(() => 'chrome-extension://id/images/icon48.png'),
      },
      storage: {
        local: {
          get: jest.fn((keys, callback) => callback({ selectionControlsVisible: true })),
        },
      },
      i18n: {
        getMessage: jest.fn(() => ''),
      },
    };

    window.eval(commonSource);
    window.eval(controlsSource);
    window.createHighlightControls();
  });

  beforeEach(() => {
    api.highlightSelection.mockClear();
    api.removeHighlightByElement.mockClear();
    api.changeHighlightColor.mockClear();
  });

  it('calls removeHighlightByElement via TextHighlighterContentAPI on delete button click', () => {
    const span = document.createElement('span');
    span.className = 'text-highlighter-extension';
    span.dataset.groupId = 'g1';
    span.textContent = 'sample';
    document.body.appendChild(span);

    window.showControlUi(span, { clientX: 10, clientY: 10 });
    const deleteButton = document.querySelector('.delete-highlight');
    deleteButton.click();

    expect(api.removeHighlightByElement).toHaveBeenCalledWith(span);
  });

  it('calls changeHighlightColor via TextHighlighterContentAPI on color button click', () => {
    const span = document.createElement('span');
    span.className = 'text-highlighter-extension';
    span.dataset.groupId = 'g2';
    span.textContent = 'sample';
    document.body.appendChild(span);

    window.showControlUi(span, { clientX: 20, clientY: 20 });
    const colorButton = document.querySelector('.text-highlighter-color-buttons .color-button');
    colorButton.click();

    expect(api.changeHighlightColor).toHaveBeenCalledWith(span, '#ffff00');
  });

  it('positions highlight controls slightly above the click point', () => {
    const span = document.createElement('span');
    span.className = 'text-highlighter-extension';
    span.dataset.groupId = 'g3';
    span.textContent = 'sample';
    document.body.appendChild(span);

    window.showControlUi(span, { clientX: 100, clientY: 100 });

    const controls = document.querySelector('.text-highlighter-controls');
    expect(controls.style.top).toBe('48px');
  });

  it('anchors mobile highlight controls to the highlight rect instead of the touch point', () => {
    const span = document.createElement('span');
    span.className = 'text-highlighter-extension';
    span.dataset.groupId = 'g4';
    span.textContent = 'sample';
    document.body.appendChild(span);

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
    const originalSendMessage = global.browser.runtime.sendMessage;

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    global.browser.runtime.sendMessage = jest.fn((message, callback) => {
      if (!callback) return;
      if (message.action === 'getPlatformInfo') {
        callback({ isMobile: true });
        return;
      }
      callback({});
    });
    window.initializeSelectionControls();

    window.showControlUi(span, { clientX: 120, clientY: 700 });

    const controls = document.querySelector('.text-highlighter-controls');
    expect(controls.style.top).toBe('68px');

    global.browser.runtime.sendMessage = originalSendMessage;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
  });
});
