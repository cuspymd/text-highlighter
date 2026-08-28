import fs from 'fs';

const contentSource = fs.readFileSync(new URL('../content-scripts/content.js', import.meta.url), 'utf8');

describe('scrollToHighlight message handling', () => {
  let sendMessageMock;
  let onMessageListener;

  beforeEach(() => {
    jest.useFakeTimers();
    document.head.innerHTML = '';
    document.body.innerHTML = '';

    sendMessageMock = jest.fn((message, callback) => {
      if (!callback) return;

      if (message.action === 'getColors') {
        callback({ colors: [] });
        return;
      }

      if (message.action === 'getHighlights') {
        callback({ highlights: [] });
        return;
      }

      callback({ success: true });
    });

    window.TextHighlighterCore = {};
    window.debugLog = jest.fn();
    window.hideHighlightControls = jest.fn();
    window.clearAllHighlights = jest.fn();
    window.updateMinimapMarkers = jest.fn();
    window.createHighlightControls = jest.fn();
    window.applyHighlights = jest.fn();
    window.initMinimap = jest.fn();
    window.scrollToHighlightElement = jest.fn();
    window.flashHighlightGroup = jest.fn();
    window.MinimapManager = jest.fn(() => ({
      init: jest.fn(),
      setVisibility: jest.fn(),
      updateMarkers: jest.fn(),
    }));

    global.browserAPI = {
      runtime: {
        sendMessage: sendMessageMock,
        getURL: jest.fn(() => 'chrome-extension://test/content-scripts/navigation-bridge.js'),
        onMessage: {
          addListener: jest.fn((listener) => {
            onMessageListener = listener;
          }),
        },
      },
      storage: {
        local: {
          get: jest.fn((keys, callback) => callback({ minimapVisible: true })),
        },
      },
    };

    window.eval(contentSource);
    jest.advanceTimersByTime(500);
    sendMessageMock.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('scrolls to and flashes the highlight when the group exists in the DOM', () => {
    document.body.innerHTML =
      "<p><span class='text-highlighter-extension' data-group-id='12345'>hello</span></p>";
    const target = document.querySelector('.text-highlighter-extension');

    const sendResponse = jest.fn();
    onMessageListener({ action: 'scrollToHighlight', groupId: '12345' }, {}, sendResponse);

    expect(window.scrollToHighlightElement).toHaveBeenCalledWith(target);
    expect(window.flashHighlightGroup).toHaveBeenCalledWith(target);
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('responds with success: false when no element matches the group', () => {
    const sendResponse = jest.fn();
    onMessageListener({ action: 'scrollToHighlight', groupId: 'missing' }, {}, sendResponse);

    expect(window.scrollToHighlightElement).not.toHaveBeenCalled();
    expect(window.flashHighlightGroup).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, reason: 'not-found' });
  });

  it('responds with success: false when groupId is missing', () => {
    const sendResponse = jest.fn();
    onMessageListener({ action: 'scrollToHighlight' }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({ success: false, reason: 'not-found' });
  });
});
