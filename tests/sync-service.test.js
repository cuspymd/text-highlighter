import chrome from '../mocks/chrome.js';
import {
  cleanupTombstones,
  normalizeSyncMeta,
  urlToSyncKey,
  mergeHighlights,
  saveSettingsToSync,
  cleanupEmptyHighlightData,
  clearAllSyncedHighlights,
  initSyncListener,
} from '../background/sync-service.js';

const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

describe('sync-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===================================================================
  // Pure functions
  // ===================================================================

  describe('cleanupTombstones', () => {
    it('should remove tombstones older than 30 days', () => {
      const now = Date.now();
      const obj = {
        old: now - TOMBSTONE_RETENTION_MS - 1000,
        fresh: now - TOMBSTONE_RETENTION_MS + 1000,
      };
      cleanupTombstones(obj);
      expect(obj.old).toBeUndefined();
      expect(obj.fresh).toBeDefined();
    });

    it('should do nothing if the object is null', () => {
      expect(() => cleanupTombstones(null)).not.toThrow();
    });

    it('should leave recent tombstones untouched', () => {
      const obj = { recent: Date.now() - 1000 };
      cleanupTombstones(obj);
      expect(obj.recent).toBeDefined();
    });
  });

  describe('normalizeSyncMeta', () => {
    it('should return a default meta object when input is null', () => {
      const meta = normalizeSyncMeta(null);
      expect(meta).toEqual({ pages: [], totalSize: 0, deletedUrls: {} });
    });

    it('should preserve existing valid data', () => {
      const raw = {
        pages: [{ url: 'test.com', syncKey: 'hl_1' }],
        totalSize: 100,
      };
      const meta = normalizeSyncMeta(raw);
      expect(meta.pages).toHaveLength(1);
      expect(meta.totalSize).toBe(100);
      expect(meta.deletedUrls).toEqual({});
    });

    it('should initialize missing pages array', () => {
      const meta = normalizeSyncMeta({ totalSize: 50 });
      expect(meta.pages).toEqual([]);
      expect(meta.totalSize).toBe(50);
    });

    it('should cleanup expired tombstones in deletedUrls', () => {
      const now = Date.now();
      const raw = {
        deletedUrls: { old: now - TOMBSTONE_RETENTION_MS - 1000 },
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

    it('should produce only alphanumeric characters after the hl_ prefix', () => {
      const key = urlToSyncKey('https://example.com/test?q=1&p=2');
      const suffix = key.slice(3); // strip 'hl_'
      expect(suffix).toMatch(/^[0-9a-z]+$/);
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

    it('should handle deletion tombstones — tombstone wins over older highlight', () => {
      const now = Date.now();
      const local = {
        highlights: [{ groupId: 'g1', updatedAt: now - 10000 }],
        deletedGroupIds: { g1: now - 5000 },
      };
      const remote = { highlights: [{ groupId: 'g1', updatedAt: now - 10000 }] };
      const result = mergeHighlights(local, remote);

      expect(result.highlights).toHaveLength(0);
      expect(result.deletedGroupIds.g1).toBe(now - 5000);
    });

    it('should allow a newer update to override an older tombstone', () => {
      const now = Date.now();
      const local = { deletedGroupIds: { g1: now - 10000 } };
      const remote = { highlights: [{ groupId: 'g1', updatedAt: now - 5000 }] };
      const result = mergeHighlights(local, remote);

      expect(result.highlights).toHaveLength(1);
      expect(result.highlights[0].groupId).toBe('g1');
    });

    it('should handle empty inputs gracefully', () => {
      const result = mergeHighlights({}, {});
      expect(result.highlights).toEqual([]);
      expect(result.deletedGroupIds).toEqual({});
    });

    it('should merge deletedGroupIds from both sides (union)', () => {
      const now = Date.now();
      const local = { deletedGroupIds: { g1: now - 1000 } };
      const remote = { deletedGroupIds: { g2: now - 2000 } };
      const result = mergeHighlights(local, remote);
      expect(result.deletedGroupIds).toHaveProperty('g1');
      expect(result.deletedGroupIds).toHaveProperty('g2');
    });
  });

  // ===================================================================
  // Async services
  // ===================================================================

  describe('saveSettingsToSync', () => {
    it('should read settings from local storage and write them to sync', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({
        customColors: [{ id: 'custom_1', color: '#AABBCC' }],
        minimapVisible: false,
        selectionControlsVisible: true,
      });
      await saveSettingsToSync();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            customColors: expect.any(Array),
            minimapVisible: false,
            selectionControlsVisible: true,
          }),
        }),
      );
    });

    it('should use defaults when local storage has no settings', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({});
      await saveSettingsToSync();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            customColors: [],
            minimapVisible: true,
            selectionControlsVisible: true,
          }),
        }),
      );
    });
  });

  describe('cleanupEmptyHighlightData', () => {
    it('should remove the url key and its _meta key from local storage', async () => {
      await cleanupEmptyHighlightData('https://example.com');
      expect(chrome.storage.local.remove).toHaveBeenCalledWith([
        'https://example.com',
        'https://example.com_meta',
      ]);
    });

    it('should do nothing if url is falsy', async () => {
      await cleanupEmptyHighlightData(null);
      expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    });
  });

  describe('clearAllSyncedHighlights', () => {
    it('should add tombstones only for URLs tracked in sync meta and then clear pages', async () => {
      const now = 1700000000000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      chrome.storage.sync.get.mockResolvedValueOnce({
        sync_meta: {
          pages: [
            { syncKey: 'hl_1', url: 'https://synced-1.test', size: 10 },
            { syncKey: 'hl_2', url: 'https://synced-2.test', size: 20 },
          ],
          totalSize: 30,
          deletedUrls: {},
        },
      });

      await clearAllSyncedHighlights();

      expect(chrome.storage.sync.remove).toHaveBeenCalledWith(['hl_1', 'hl_2']);

      expect(chrome.storage.sync.set).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          sync_meta: expect.objectContaining({
            pages: expect.any(Array),
            totalSize: 30,
            deletedUrls: {
              'https://synced-1.test': now,
              'https://synced-2.test': now,
            },
          }),
        }),
      );

      expect(chrome.storage.sync.set).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          sync_meta: expect.objectContaining({
            pages: [],
            totalSize: 0,
            deletedUrls: {
              'https://synced-1.test': now,
              'https://synced-2.test': now,
            },
          }),
        }),
      );

      Date.now.mockRestore();
    });
  });

  describe('initSyncListener', () => {
    it('should register a storage.onChanged listener', () => {
      initSyncListener({});
      expect(chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(1);
    });

    it('should invoke onSettingsChanged when the sync settings key changes', async () => {
      const onSettingsChanged = jest.fn().mockResolvedValue(undefined);
      initSyncListener({ onSettingsChanged });

      const listener = chrome.storage.onChanged.addListener.mock.calls.at(-1)[0];
      const newSettings = { customColors: [], minimapVisible: false };
      await listener({ settings: { newValue: newSettings } }, 'sync');

      expect(onSettingsChanged).toHaveBeenCalledWith(newSettings);
    });

    it('should NOT invoke onSettingsChanged for local storage changes', async () => {
      const onSettingsChanged = jest.fn();
      initSyncListener({ onSettingsChanged });

      const listener = chrome.storage.onChanged.addListener.mock.calls.at(-1)[0];
      await listener({ settings: { newValue: {} } }, 'local');

      expect(onSettingsChanged).not.toHaveBeenCalled();
    });
  });
});
