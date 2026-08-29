import { jest } from '@jest/globals';
import fs from 'fs';
import chrome, { assertNoTabMessageCallback } from '../../mocks/chrome.js';

/**
 * Harness for the extension's page scripts (popup.js, pages-list.js, settings.js).
 *
 * These are not modules a test can call into: the whole body sits inside one
 * `DOMContentLoaded` closure with no exports. So the test drives them the way the
 * browser does - put the page's own markup in the document, load the script, then
 * run its handler - and reads the result off the DOM.
 */

const BODY = /<body[^>]*>([\s\S]*?)<\/body>/i;
const SCRIPT = /<script[\s\S]*?<\/script>/gi;

/**
 * The body of an extension page, without the `<script>` tag that jsdom would
 * otherwise try to fetch. The test loads the script itself.
 */
export function readPageBody(htmlUrl) {
  const html = fs.readFileSync(htmlUrl, 'utf8');
  const match = html.match(BODY);

  if (!match) {
    throw new Error(`No <body> found in ${htmlUrl}`);
  }

  return match[1].replace(SCRIPT, '');
}

/**
 * What a page script expects from the browser but jsdom does not provide.
 * Call it before loading the script: `initializeThemeWatcher` reads `matchMedia`
 * on the first line of the handler, and jsdom's own `close` would tear down the
 * window the remaining tests run in.
 */
export function stubPageEnvironment() {
  window.matchMedia = jest.fn(() => ({
    matches: false,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
  window.close = jest.fn();

  return { close: window.close };
}

/**
 * Load a page script and hand back its `DOMContentLoaded` handler.
 *
 * The handler is captured rather than dispatched, because it is `async`:
 * `dispatchEvent` returns before the page has finished loading its data, so a
 * test that dispatches ends up asserting against an empty list. Awaiting the
 * captured handler waits for the real thing.
 *
 * ESM caching means the script registers its handler once per test file, so call
 * this once; the returned function can be run as often as a test needs, each run
 * initializing whatever markup is in the document at that moment.
 */
export async function loadPageScript(importPage) {
  let handler = null;

  const addEventListener = document.addEventListener.bind(document);
  const spy = jest.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    if (type === 'DOMContentLoaded') {
      handler = listener;
      return;
    }
    return addEventListener(type, listener, options);
  });

  try {
    await importPage();
  } finally {
    spy.mockRestore();
  }

  if (!handler) {
    throw new Error('The page script registered no DOMContentLoaded handler');
  }

  return () => handler(new Event('DOMContentLoaded'));
}

/**
 * Answer the page's tab messages with `handler(message, tabId)`, and reject the
 * callback form outright.
 *
 * A mock that merely returns a promise cannot catch a callback: the caller gets a
 * promise it ignores, nothing happens, and the test fails somewhere unrelated -
 * which is the same silence Firefox gives. Throwing names the actual mistake.
 * See "Extension API calls" in AGENTS.md.
 */
export function respondToTab(handler) {
  chrome.tabs.sendMessage.mockImplementation((tabId, message, ...optionalArgs) => {
    assertNoTabMessageCallback(optionalArgs);
    return Promise.resolve(handler(message, tabId));
  });
}

/**
 * Flush the promises a page script is waiting on, and the timers it has queued.
 * Both are needed together: the poll that waits out a restore alternates between
 * a `setTimeout` and an awaited round trip, so advancing timers alone leaves the
 * continuation unrun.
 */
export async function advance(ms = 0) {
  await jest.advanceTimersByTimeAsync(ms);
}
