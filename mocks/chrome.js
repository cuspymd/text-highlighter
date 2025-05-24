module.exports = {
  runtime: {
    sendMessage: jest.fn((message, callback) => {
      if (message.action === 'saveHighlights') {
        if (callback) callback({ success: true });
      }
    }),
    onMessage: {
      addListener: jest.fn(),
    },
    lastError: null,
  },
  i18n: {
    getMessage: jest.fn(key => key),
  },
  storage: {
    local: {
      get: jest.fn((keys, callback) => callback({})),
      set: jest.fn((items, callback) => callback()),
    }
  },
  contextMenus: {
    create: jest.fn(),
    onClicked: {
      addListener: jest.fn(),
    },
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn(),
  }
};
