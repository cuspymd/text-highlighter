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
    // jsdom keeps the location between tests; start each one on the bare page.
    window.history.replaceState(null, '', '/article');

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
    window.location.hash = '#/next';
    const actualHref = window.location.href;

    announceLocation(actualHref);

    await jest.advanceTimersByTimeAsync(1000);

    expect(highlightsRequestedFor(actualHref)).toBe(true);
  });

  // Moving the page to the given URL the way the bridge reports it.
  async function moveTo(path) {
    window.history.pushState(null, '', path);
    announceLocation(window.location.href);
    await jest.advanceTimersByTimeAsync(1000);
  }

  function highlightRequests() {
    return chrome.runtime.sendMessage.mock.calls
      .filter(([message]) => message.action === 'getHighlights');
  }

  describe('in-page anchors', () => {
    it('keeps the highlights when a link jumps to an anchor on the same page', async () => {
      await moveTo('/article#chapter-2');

      expect(window.hideHighlightControls).not.toHaveBeenCalled();
      expect(highlightRequests()).toHaveLength(0);
    });

    it('keeps them when moving between anchors and back to the bare page', async () => {
      await moveTo('/article#chapter-2');
      await moveTo('/article#chapter-3');
      await moveTo('/article');

      expect(window.hideHighlightControls).not.toHaveBeenCalled();
      expect(highlightRequests()).toHaveLength(0);
    });

    it('goes on saving under the URL the page was loaded with', async () => {
      document.body.innerHTML = '<p>Saved under the page it was loaded as.</p>';
      await moveTo('/article#chapter-2');

      const text = document.querySelector('p').firstChild;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 5);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      window.highlightSelectedText('#ffff00');
      await jest.advanceTimersByTimeAsync(0);

      const saves = chrome.runtime.sendMessage.mock.calls
        .map(([message]) => message)
        .filter(message => message.action === 'saveHighlights');
      expect(saves.map(message => message.url)).toEqual(['http://localhost/article']);
    });
  });

  describe('hash routes', () => {
    it.each(['#/inbox', '#!/post/1'])('treats %s as a new screen', async hash => {
      await moveTo(`/article${hash}`);

      expect(window.hideHighlightControls).toHaveBeenCalled();
      expect(highlightsRequestedFor(`http://localhost/article${hash}`)).toBe(true);
    });

    it('treats a move from a route to an anchor as a new screen', async () => {
      await moveTo('/article#/inbox');
      window.hideHighlightControls.mockClear();
      chrome.runtime.sendMessage.mockClear();

      await moveTo('/article#top');

      expect(window.hideHighlightControls).toHaveBeenCalled();
      expect(highlightsRequestedFor('http://localhost/article#top')).toBe(true);
    });
  });

  it('still treats a change of path as a new page', async () => {
    await moveTo('/other#chapter-2');

    expect(window.hideHighlightControls).toHaveBeenCalled();
    expect(highlightsRequestedFor('http://localhost/other#chapter-2')).toBe(true);
  });
});
