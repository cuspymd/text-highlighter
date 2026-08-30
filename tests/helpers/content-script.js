import { jest } from '@jest/globals';
import fs from 'fs';
import chrome from '../../mocks/chrome.js';

/**
 * Harness for the content scripts.
 *
 * These are not modules a test can import: the manifest injects them in order
 * and they find each other through `window`. So a test loads them the way the
 * manifest does - evaluate the sources into the page, in that order - and drives
 * the result through the DOM and the message listener.
 *
 * Before this existed each test built its own `browserAPI` inline, which is why
 * the guards in `mocks/chrome.js` never reached any of them. Everything here
 * goes through the shared mock instead.
 */

const SOURCES = {
  common: '../../content-scripts/content-common.js',
  minimap: '../../content-scripts/minimap.js',
  controls: '../../content-scripts/controls.js',
  content: '../../content-scripts/content.js',
};

// Loading order is the manifest's, not the caller's.
const LOAD_ORDER = ['common', 'minimap', 'controls', 'content'];

const sourceCache = new Map();

function readSource(name) {
  if (!SOURCES[name]) {
    throw new Error(`Unknown content script "${name}"`);
  }
  if (!sourceCache.has(name)) {
    sourceCache.set(name, fs.readFileSync(new URL(SOURCES[name], import.meta.url), 'utf8'));
  }
  return sourceCache.get(name);
}

/**
 * The globals a content script expects its neighbours to have defined.
 *
 * A test that loads only `content.js` still needs whatever `controls.js` and
 * `minimap.js` publish, because the manifest would have run them first. Keeping
 * the list here means adding a function to `controls.js` does not break four
 * test files at once.
 */
const NEIGHBOUR_GLOBALS = {
  common: [
    'debugLog',
    'errorLog',
    'getMessage',
    'findHighlightElementsByGroupId',
    'scrollToHighlightElement',
    'flashHighlightGroup',
  ],
  controls: [
    'createHighlightControls',
    'hideHighlightControls',
    'refreshHighlightControlsColors',
    'setSelectionControlsVisibility',
    'initializeSelectionControls',
  ],
  minimap: [
    'initMinimap',
    'updateMinimapMarkers',
  ],
  content: [
    'applyHighlights',
    'clearAllHighlights',
  ],
};

function stubNeighbours(loaded) {
  Object.entries(NEIGHBOUR_GLOBALS).forEach(([owner, names]) => {
    if (loaded.includes(owner)) return;
    names.forEach(name => { window[name] = jest.fn(); });
  });

  if (!loaded.includes('minimap')) {
    window.MinimapManager = jest.fn(() => ({
      init: jest.fn(),
      setVisibility: jest.fn(),
      updateMarkers: jest.fn(),
    }));
  }

  if (!loaded.includes('common')) {
    // The one neighbour global with behaviour a test actually depends on:
    // several assertions are about which spans a group resolves to.
    window.findHighlightElementsByGroupId = groupId =>
      [...document.querySelectorAll('.text-highlighter-extension')]
        .filter(element => element.dataset.groupId === groupId);
  }
}

/**
 * Answer the content script's background messages with `handler(message)`.
 *
 * Returning `undefined` from the handler stands for a background that answered
 * with nothing; throwing stands for one that is not listening at all, which is a
 * rejection on both browsers.
 */
export function respondToBackground(handler) {
  chrome.runtime.sendMessage.mockImplementation(message => {
    try {
      return Promise.resolve(handler(message));
    } catch (error) {
      return Promise.reject(error);
    }
  });
}

/**
 * Answer `storage.local.get` with `values`.
 *
 * Unlike the messages, this one is still read back through a callback in
 * `content.js`, so the stub has to serve both shapes - the callback the code
 * uses today, and the promise it would use if that call moves too.
 */
export function respondToStorage(values) {
  chrome.storage.local.get.mockImplementation((keys, callback) => {
    if (typeof callback === 'function') callback(values);
    return Promise.resolve(values);
  });
}

/**
 * Load content scripts into the current document.
 *
 * `scripts` names which ones to evaluate; the rest are stubbed. `browserAPI` is
 * the shared chrome mock, reachable as `chrome` from the test for assertions.
 * Returns the `runtime.onMessage` listener the scripts registered, which is how
 * the background and the popup talk to them.
 */
export function loadContentScripts(scripts) {
  const loaded = LOAD_ORDER.filter(name => scripts.includes(name));

  const unknown = scripts.filter(name => !LOAD_ORDER.includes(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown content script(s): ${unknown.join(', ')}`);
  }

  stubNeighbours(loaded);

  // content-common.js reads `window.browserAPI` before falling back to the
  // `browser` / `chrome` globals, and content.js uses whatever it left behind.
  window.browserAPI = chrome;
  global.browserAPI = chrome;

  let messageListener = null;
  chrome.runtime.onMessage.addListener.mockImplementation(listener => {
    messageListener = listener;
  });

  loaded.forEach(name => window.eval(readSource(name)));

  return {
    /** Deliver a message the way the background or the popup would. */
    sendToContentScript(message) {
      if (!messageListener) {
        throw new Error('No content script registered a runtime.onMessage listener');
      }
      return new Promise(resolve => {
        const kept = messageListener(message, {}, resolve);
        if (!kept) resolve(undefined);
      });
    },
    get messageListener() {
      return messageListener;
    },
  };
}

/**
 * Clear what a previous load left on `window`, so the next test starts from a
 * page with none of it. The scripts assign to globals rather than exporting, so
 * nothing else takes them back off.
 */
export function resetContentScriptEnvironment() {
  document.head.innerHTML = '';
  document.body.innerHTML = '';

  const owned = [
    ...Object.values(NEIGHBOUR_GLOBALS).flat(),
    'MinimapManager',
    'TextHighlighterState',
    'TextHighlighterContentAPI',
    'browserAPI',
    'currentColors',
  ];
  owned.forEach(name => { delete window[name]; });
  delete global.browserAPI;
}
