import fs from 'fs';

const contentSource = fs.readFileSync(new URL('../content-scripts/content.js', import.meta.url), 'utf8');

describe('content navigation bridge message handling', () => {
  let sendMessageMock;

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
          addListener: jest.fn(),
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

  it('ignores location-changed messages whose href does not match the actual page URL', () => {
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        source: 'text-highlighter-navigation-bridge',
        type: 'location-changed',
        href: 'https://example.com/forged',
        trigger: 'test',
      },
    }));

    jest.advanceTimersByTime(1000);

    expect(window.hideHighlightControls).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'getHighlights', url: 'https://example.com/forged' }),
      expect.any(Function)
    );
  });

  it('accepts location-changed messages when href matches the actual page URL', () => {
    window.location.hash = '#next';
    const actualHref = window.location.href;

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        source: 'text-highlighter-navigation-bridge',
        type: 'location-changed',
        href: actualHref,
        trigger: 'test',
      },
    }));

    jest.advanceTimersByTime(1000);

    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'getHighlights', url: actualHref }),
      expect.any(Function)
    );
  });
});
