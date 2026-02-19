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
});
