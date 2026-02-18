import chrome from '../mocks/chrome.js';
import { registerMessageRouter } from '../background/message-router.js';

describe('message-router', () => {
  let listener;

  beforeEach(() => {
    jest.clearAllMocks();
    registerMessageRouter();
    // Capture the most recently registered onMessage listener
    listener = chrome.runtime.onMessage.addListener.mock.calls.at(-1)[0];
  });

  /**
   * Helper: invoke the registered listener and return a Promise that resolves
   * with the value passed to sendResponse (handles both sync and async handlers).
   */
  function sendMessage(message) {
    return new Promise(resolve => {
      listener(message, {}, resolve);
    });
  }

  // ===================================================================
  // Registration
  // ===================================================================

  describe('registerMessageRouter', () => {
    it('should register exactly one runtime.onMessage listener', () => {
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    });
  });

  // ===================================================================
  // Routing — error cases
  // ===================================================================

  describe('routing — unknown actions', () => {
    it('should return a failure response for an unknown action', async () => {
      const result = await sendMessage({ action: 'doesNotExist' });
      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('doesNotExist'),
      });
    });
  });

  // ===================================================================
  // Routing — info / read-only handlers
  // ===================================================================

  describe('routing — getDebugMode', () => {
    it('should return a debugMode boolean', async () => {
      const result = await sendMessage({ action: 'getDebugMode' });
      expect(result).toHaveProperty('debugMode');
      expect(typeof result.debugMode).toBe('boolean');
    });
  });

  describe('routing — getPlatformInfo', () => {
    it('should return platform and isMobile fields', async () => {
      const result = await sendMessage({ action: 'getPlatformInfo' });
      expect(result).toHaveProperty('platform');
      expect(result).toHaveProperty('isMobile');
    });
  });

  describe('routing — getColors', () => {
    it('should return an array of at least 5 colors', async () => {
      const result = await sendMessage({ action: 'getColors' });
      expect(result).toHaveProperty('colors');
      expect(Array.isArray(result.colors)).toBe(true);
      expect(result.colors.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('routing — getHighlights', () => {
    it('should return stored highlights for a url', async () => {
      const url = 'https://example.com';
      chrome.storage.local.get.mockResolvedValueOnce({
        [url]: [{ groupId: 'g1', color: '#FFFF00' }],
      });
      const result = await sendMessage({ action: 'getHighlights', url });

      expect(result).toHaveProperty('highlights');
      expect(result.highlights).toHaveLength(1);
      expect(result.highlights[0].groupId).toBe('g1');
    });

    it('should return an empty highlights array when nothing is stored', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({});
      const result = await sendMessage({ action: 'getHighlights', url: 'https://empty.com' });

      expect(result.highlights).toEqual([]);
    });
  });

  describe('routing — getAllHighlightedPages', () => {
    it('should return a pages array', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({});
      const result = await sendMessage({ action: 'getAllHighlightedPages' });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.pages)).toBe(true);
    });
  });
});
