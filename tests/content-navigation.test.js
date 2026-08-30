import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import {
  loadContentScripts,
  respondToBackground,
  respondToStorage,
  resetContentScriptEnvironment,
} from './helpers/content-script.js';

describe('content navigation bridge message handling', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetContentScriptEnvironment();

    respondToBackground(message => {
      if (message.action === 'getColors') return { colors: [] };
      if (message.action === 'getHighlights') return { highlights: [] };
      return { success: true };
    });
    respondToStorage({ minimapVisible: true });

    loadContentScripts(['content']);

    // Past the deferred first load, so the calls under test are the only ones.
    await jest.advanceTimersByTimeAsync(500);
    chrome.runtime.sendMessage.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetContentScriptEnvironment();
  });

  function announceLocation(href) {
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        source: 'text-highlighter-navigation-bridge',
        type: 'location-changed',
        href,
        trigger: 'test',
      },
    }));
  }

  function highlightsRequestedFor(url) {
    return chrome.runtime.sendMessage.mock.calls.some(
      ([message]) => message.action === 'getHighlights' && message.url === url
    );
  }

  it('ignores location-changed messages whose href does not match the actual page URL', async () => {
    announceLocation('https://example.com/forged');

    await jest.advanceTimersByTimeAsync(1000);

    expect(window.hideHighlightControls).not.toHaveBeenCalled();
    expect(highlightsRequestedFor('https://example.com/forged')).toBe(false);
  });

  it('accepts location-changed messages when href matches the actual page URL', async () => {
    window.location.hash = '#next';
    const actualHref = window.location.href;

    announceLocation(actualHref);

    await jest.advanceTimersByTimeAsync(1000);

    expect(highlightsRequestedFor(actualHref)).toBe(true);
  });
});
