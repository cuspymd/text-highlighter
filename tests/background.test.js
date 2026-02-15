const chrome = require('../mocks/chrome.js');
global.chrome = chrome;

// Mock the global Date.now() if needed, but for now we can just use offsets
const {
  cleanupTombstones,
  normalizeSyncMeta,
  urlToSyncKey,
  mergeHighlights,
  isMobile,
  platformInfo
} = require('../background.js');

describe('Background Script Unit Tests', () => {
  const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

  describe('cleanupTombstones', () => {
    it('should remove tombstones older than 30 days', () => {
      const now = Date.now();
      const obj = {
        'old': now - TOMBSTONE_RETENTION_MS - 1000,
        'new': now - TOMBSTONE_RETENTION_MS + 1000
      };
      cleanupTombstones(obj);
      expect(obj.old).toBeUndefined();
      expect(obj.new).toBeDefined();
    });

    it('should do nothing if object is null or empty', () => {
      const obj = null;
      expect(() => cleanupTombstones(obj)).not.toThrow();
    });
  });

  describe('normalizeSyncMeta', () => {
    it('should return a default meta object when input is null', () => {
      const meta = normalizeSyncMeta(null);
      expect(meta).toEqual({
        pages: [],
        totalSize: 0,
        deletedUrls: {}
      });
    });

    it('should preserve existing valid data', () => {
      const raw = {
        pages: [{ url: 'test.com', syncKey: 'hl_1' }],
        totalSize: 100
      };
      const meta = normalizeSyncMeta(raw);
      expect(meta.pages).toHaveLength(1);
      expect(meta.totalSize).toBe(100);
      expect(meta.deletedUrls).toEqual({});
    });

    it('should cleanup tombstones in deletedUrls', () => {
      const now = Date.now();
      const raw = {
        deletedUrls: {
          'old': now - TOMBSTONE_RETENTION_MS - 1000
        }
      };
      const meta = normalizeSyncMeta(raw);
      expect(meta.deletedUrls.old).toBeUndefined();
    });
  });

  describe('urlToSyncKey', () => {
    it('should generate a consistent key starting with hl_', () => {
      const url = 'https://example.com/page1';
      const key1 = urlToSyncKey(url);
      const key2 = urlToSyncKey(url);

      expect(key1).toBe(key2);
      expect(key1.startsWith('hl_')).toBe(true);
    });

    it('should generate different keys for different URLs', () => {
      const key1 = urlToSyncKey('https://example.com/page1');
      const key2 = urlToSyncKey('https://example.com/page2');
      expect(key1).not.toBe(key2);
    });
  });

  describe('mergeHighlights', () => {
    it('should merge two disjoint sets of highlights', () => {
      const local = { highlights: [{ groupId: 'g1', updatedAt: 100 }] };
      const remote = { highlights: [{ groupId: 'g2', updatedAt: 200 }] };
      const result = mergeHighlights(local, remote);

      expect(result.highlights).toHaveLength(2);
      expect(result.highlights.map(h => h.groupId)).toContain('g1');
      expect(result.highlights.map(h => h.groupId)).toContain('g2');
    });

    it('should favor the newer version of a highlight based on updatedAt', () => {
      const local = { highlights: [{ groupId: 'g1', text: 'old', updatedAt: 100 }] };
      const remote = { highlights: [{ groupId: 'g1', text: 'new', updatedAt: 200 }] };
      const result = mergeHighlights(local, remote);

      expect(result.highlights).toHaveLength(1);
      expect(result.highlights[0].text).toBe('new');
    });

    it('should handle deletion tombstones', () => {
      const now = Date.now();
      const local = {
        highlights: [{ groupId: 'g1', updatedAt: now - 10000 }],
        deletedGroupIds: { 'g1': now - 5000 }
      };
      const remote = { highlights: [{ groupId: 'g1', updatedAt: now - 10000 }] };
      const result = mergeHighlights(local, remote);

      expect(result.highlights).toHaveLength(0);
      expect(result.deletedGroupIds.g1).toBe(now - 5000);
    });

    it('should allow a newer update to override an older tombstone', () => {
      const now = Date.now();
      const local = { deletedGroupIds: { 'g1': now - 10000 } };
      const remote = { highlights: [{ groupId: 'g1', updatedAt: now - 5000 }] };
      const result = mergeHighlights(local, remote);

      expect(result.highlights).toHaveLength(1);
      expect(result.highlights[0].groupId).toBe('g1');
    });
  });

  describe('isMobile', () => {
    it('should return true if platform is android', () => {
      // Directly manipulate the exported object properties
      platformInfo.os = 'android';
      expect(isMobile()).toBe(true);
    });

    it('should return false if platform is mac', () => {
      platformInfo.os = 'mac';
      expect(isMobile()).toBe(false);
    });
  });
});
