import chrome, { assertNoTabMessageCallback } from '../mocks/chrome.js';
import { broadcastToAllTabs, broadcastToTabsByUrl, sendMessageToTab } from '../shared/tab-broadcast.js';

describe('tab-broadcast', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendMessageToTab', () => {
    it('should return the tab response', async () => {
      const message = { action: 'test' };
      chrome.tabs.sendMessage.mockResolvedValueOnce({ success: true });

      await expect(sendMessageToTab(7, message)).resolves.toEqual({ success: true });
    });

    it('should call with only a tab id and a message', async () => {
      const message = { action: 'test' };

      await sendMessageToTab(7, message);

      // Exactly two arguments. Firefox reads a third as options, so a callback
      // there is never called - see AGENTS.md "Extension API calls".
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, message);
    });

    it('should return null when nothing is listening on the tab', async () => {
      chrome.tabs.sendMessage.mockRejectedValueOnce(new Error('no receiver'));

      await expect(sendMessageToTab(7, { action: 'test' })).resolves.toBeNull();
    });
  });

  describe('broadcastToAllTabs', () => {
    it('should broadcast message to all tabs', async () => {
      const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }];
      chrome.tabs.query.mockResolvedValue(tabs);
      const message = { action: 'test' };

      await broadcastToAllTabs(message);

      expect(chrome.tabs.query).toHaveBeenCalledWith({});
      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(3);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, message);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, message);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(3, message);
    });

    it('should ignore errors when sending message fails', async () => {
      const tabs = [{ id: 1 }, { id: 2 }];
      chrome.tabs.query.mockResolvedValue(tabs);
      const message = { action: 'test' };

      // Make the first call fail
      chrome.tabs.sendMessage.mockRejectedValueOnce(new Error('Failed'));

      await broadcastToAllTabs(message);

      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, message);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, message);
    });
  });

  describe('broadcastToTabsByUrl', () => {
    it('should broadcast message to tabs with matching URL', async () => {
      const url = 'https://example.com/*';
      const tabs = [{ id: 1 }, { id: 2 }];
      chrome.tabs.query.mockResolvedValue(tabs);
      const message = { action: 'test' };

      await broadcastToTabsByUrl(url, message);

      expect(chrome.tabs.query).toHaveBeenCalledWith({ url });
      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, message);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, message);
    });

    it('should skip tabs without id', async () => {
      const url = 'https://example.com/*';
      const tabs = [{ id: 1 }, { noId: true }];
      chrome.tabs.query.mockResolvedValue(tabs);
      const message = { action: 'test' };

      await broadcastToTabsByUrl(url, message);

      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, message);
    });

    it('leaves out the excluded tab', async () => {
      const url = 'https://example.com/*';
      chrome.tabs.query.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const message = { action: 'test' };

      await broadcastToTabsByUrl(url, message, { excludeTabId: 2 });

      expect(chrome.tabs.sendMessage.mock.calls.map(([tabId]) => tabId)).toEqual([1, 3]);
    });

    it('should handle errors gracefully', async () => {
      const url = 'https://example.com/*';
      const tabs = [{ id: 1 }];
      chrome.tabs.query.mockResolvedValue(tabs);
      const message = { action: 'test' };

      chrome.tabs.sendMessage.mockRejectedValue(new Error('Failed'));

      // The function should not throw, we just await it
      await broadcastToTabsByUrl(url, message);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, message);
    });
  });

  // The mock has to fail on a form the browser only fails on silently, so that
  // a Chromium-green run cannot hide it.
  describe('the promise-form guard', () => {
    it('rejects a callback in the third argument', () => {
      expect(() => assertNoTabMessageCallback([() => {}])).toThrow(/never runs on Firefox/);
    });

    it("rejects a callback after Chrome's options argument", () => {
      expect(() => assertNoTabMessageCallback([{ frameId: 0 }, () => {}])).toThrow(/never runs on Firefox/);
    });

    it('allows options on their own', () => {
      expect(() => assertNoTabMessageCallback([{ frameId: 0 }])).not.toThrow();
    });
  });
});
