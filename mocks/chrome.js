import { jest } from '@jest/globals';

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
    sendMessage: jest.fn(() => Promise.resolve()),
    onActivated: {
      addListener: jest.fn(),
    },
  },
  commands: {
    getAll: jest.fn(() => Promise.resolve([])),
    onCommand: {
      addListener: jest.fn(),
    },
  },
};
