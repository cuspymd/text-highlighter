import chrome from '../mocks/chrome.js';
import { broadcastToAllTabs, broadcastToTabsByUrl } from '../shared/tab-broadcast.js';

describe('tab-broadcast', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    it('should handle errors gracefully', async () => {
      const url = 'https://example.com/*';
      const tabs = [{ id: 1 }];
      chrome.tabs.query.mockResolvedValue(tabs);
      const message = { action: 'test' };

      chrome.tabs.sendMessage.mockRejectedValue(new Error('Failed'));

      await expect(broadcastToTabsByUrl(url, message)).resolves.not.toThrow();
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, message);
    });
  });
});
