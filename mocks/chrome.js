import { jest } from '@jest/globals';

/**
 * Tab messages must go out in the promise form: a callback never runs on Firefox,
 * where the third argument is an options object. Chrome's four-argument overload
 * puts the callback after those options, so every argument past the message has
 * to be checked - a guard that only looks at the third one waves that form
 * through. See "Extension API calls" in AGENTS.md.
 */
export function assertNoTabMessageCallback(optionalArgs) {
  if (optionalArgs.some(arg => typeof arg === 'function')) {
    throw new Error(
      'tabs.sendMessage was called with a callback, which never runs on Firefox. ' +
      'Use the promise form - send tab messages through sendMessageToTab().'
    );
  }
}

export default {
  runtime: {
    sendMessage: jest.fn((message, callback) => {
      if (message.action === 'saveHighlights') {
        if (callback) callback({ success: true });
      }
    }),
    onMessage: {
      addListener: jest.fn(),
    },
    onInstalled: {
      addListener: jest.fn(),
    },
    getPlatformInfo: jest.fn(() => Promise.resolve({ os: 'mac' })),
    getURL: jest.fn(path => `chrome-extension://test/${path}`),
    lastError: null,
  },
  i18n: {
    getMessage: jest.fn(key => key),
  },
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        const result = {};
        if (callback) callback(result);
        return Promise.resolve(result);
      }),
      set: jest.fn((items, callback) => {
        if (callback) callback();
        return Promise.resolve();
      }),
      remove: jest.fn((keys, callback) => {
        if (callback) callback();
        return Promise.resolve();
      }),
    },
    sync: {
      get: jest.fn((keys) => Promise.resolve({})),
      set: jest.fn((items) => Promise.resolve()),
      remove: jest.fn((keys) => Promise.resolve()),
    },
    onChanged: {
      addListener: jest.fn(),
    }
  },
  contextMenus: {
    create: jest.fn(),
    removeAll: jest.fn(() => Promise.resolve()),
    onClicked: {
      addListener: jest.fn(),
    },
  },
  tabs: {
    query: jest.fn(() => Promise.resolve([])),
    get: jest.fn(tabId => Promise.resolve({ id: tabId, url: 'https://example.com/' })),
    create: jest.fn(() => Promise.resolve({ id: 1 })),
    update: jest.fn(() => Promise.resolve({})),
    // A mock that only returns a promise stays silent about the callback form,
    // which is the very failure mode being guarded.
    sendMessage: jest.fn((tabId, message, ...optionalArgs) => {
      assertNoTabMessageCallback(optionalArgs);
      return Promise.resolve();
    }),
    onActivated: {
      addListener: jest.fn(),
    },
  },
  // Absent on Firefox Android, so pages that use it check for it first.
  windows: {
    getAll: jest.fn(() => Promise.resolve([])),
    create: jest.fn(() => Promise.resolve({ id: 1 })),
    update: jest.fn(() => Promise.resolve({})),
  },
  commands: {
    getAll: jest.fn(() => Promise.resolve([])),
    onCommand: {
      addListener: jest.fn(),
    },
  },
  alarms: {
    create: jest.fn(),
    onAlarm: {
      addListener: jest.fn(),
    },
  },
};
