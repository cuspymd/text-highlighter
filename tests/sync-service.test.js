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
  getSettingsMissingLocally,
  migrateLocalToSync,
  toSyncHighlightGroup,
  fitSyncMeta,
  getSyncedPages,
  syncSaveHighlights,
  syncRemoveHighlights,
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
      expect(meta).toEqual({ deletedUrls: {} });
    });

    it('drops the page list an older version kept and keeps the tombstones', () => {
      const deletedAt = Date.now() - 1000;
      const meta = normalizeSyncMeta({
        pages: [{ url: 'test.com', syncKey: 'hl_1' }],
        totalSize: 100,
        deletedUrls: { 'https://gone.test': deletedAt },
      });
      expect(meta).toEqual({ deletedUrls: { 'https://gone.test': deletedAt } });
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

  describe('toSyncHighlightGroup', () => {
    it('strips spans from highlight group', () => {
      const group = {
        groupId: 'g1',
        color: '#ffff00',
        text: 'hello',
        spans: [{ spanId: 's1', text: 'hello', position: 10 }],
        selectors: {
           quote: { prefix: 'a', suffix: 'b' }
        }
      };
      const synced = toSyncHighlightGroup(group);
      expect(synced.spans).toBeUndefined();
      expect(synced.groupId).toBe('g1');
      expect(synced.selectors.quote.prefix).toBe('a');
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

    it('should keep the newer tombstone when both sides deleted the same highlight', () => {
      const now = Date.now();
      const local = { deletedGroupIds: { g1: now - 1000 } };
      const remote = { deletedGroupIds: { g1: now - 3000 } };
      const result = mergeHighlights(local, remote);
      expect(result.deletedGroupIds.g1).toBe(now - 1000);
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

    // A profile that upgraded into the setting has no local value for it. What
    // goes out then is what sync already holds - a `false` written over another
    // device's `true` would disable it everywhere, because the whole settings
    // object is replaced by this write.
    it('should keep the synced one-click value when this device has none of its own', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({ minimapVisible: true });
      chrome.storage.sync.get.mockResolvedValueOnce({
        settings: { oneClickHighlightEnabled: true, shortcutColorMap: null },
      });

      await saveSettingsToSync();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ oneClickHighlightEnabled: true }),
        }),
      );
    });

    it('should send this device own one-click value over the synced one', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({ oneClickHighlightEnabled: false });
      chrome.storage.sync.get.mockResolvedValueOnce({
        settings: { oneClickHighlightEnabled: true, shortcutColorMap: null },
      });

      await saveSettingsToSync();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ oneClickHighlightEnabled: false }),
        }),
      );
    });

    // The same rule as the one-click setting: no local value is no opinion.
    it('should keep the synced hide-default-colours value when this device has none of its own', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({ oneClickHighlightEnabled: false });
      chrome.storage.sync.get.mockResolvedValueOnce({
        settings: { hideDefaultColors: true, shortcutColorMap: null },
      });

      await saveSettingsToSync();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ hideDefaultColors: true }),
        }),
      );
    });

    it('should send this device own hide-default-colours value over the synced one', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({ hideDefaultColors: false });
      chrome.storage.sync.get.mockResolvedValueOnce({
        settings: { hideDefaultColors: true, shortcutColorMap: null },
      });

      await saveSettingsToSync();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ hideDefaultColors: false }),
        }),
      );
    });

    it('should send no one-click value when neither this device nor sync has one', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({ minimapVisible: true });
      chrome.storage.sync.get.mockResolvedValueOnce({
        settings: { minimapVisible: true, shortcutColorMap: null },
      });

      await saveSettingsToSync();

      const [[written]] = chrome.storage.sync.set.mock.calls;
      expect(written.settings).not.toHaveProperty('oneClickHighlightEnabled');
    });
  });

  // A fresh install pulls what sync already knows before it writes anything
  // back. A setting the merge forgets is read back as its default and pushed
  // over the value the other devices are using, so this walks the whole round
  // trip against a local store that answers with what was written to it.
  // A key introduced after a profile migrated is absent locally, and the value
  // another device chose is already sitting in sync with no change event left
  // to announce it. The settings page and the content scripts read local
  // storage, so something has to hand it to them.
  describe('getSettingsMissingLocally', () => {
    it('reports a synced setting this device has no value for', async () => {
      chrome.storage.sync.get.mockResolvedValueOnce({
        settings: { minimapVisible: true, oneClickHighlightEnabled: true },
      });
      chrome.storage.local.get.mockResolvedValueOnce({ minimapVisible: true });

      expect(await getSettingsMissingLocally()).toEqual({ oneClickHighlightEnabled: true });
    });

    it('leaves alone a setting this device already has an opinion about', async () => {
      chrome.storage.sync.get.mockResolvedValueOnce({
        settings: { oneClickHighlightEnabled: true },
      });
      chrome.storage.local.get.mockResolvedValueOnce({ oneClickHighlightEnabled: false });

      expect(await getSettingsMissingLocally()).toBeNull();
    });

    it('reports nothing when sync has no settings, or cannot be read', async () => {
      chrome.storage.sync.get.mockResolvedValueOnce({});
      expect(await getSettingsMissingLocally()).toBeNull();

      chrome.storage.sync.get.mockRejectedValueOnce(new Error('sync unavailable'));
      expect(await getSettingsMissingLocally()).toBeNull();
    });
  });

  describe('migrateLocalToSync', () => {
    it('keeps a synced one-click setting instead of pushing this device default over it', async () => {
      // A device that has never had the setting: nothing local, no migration flag.
      const local = {};
      chrome.storage.local.get.mockImplementation(async (keys) => {
        if (keys === null) return { ...local };
        const wanted = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(
          wanted.filter(key => key in local).map(key => [key, local[key]])
        );
      });
      chrome.storage.local.set.mockImplementation(async (items) => {
        Object.assign(local, items);
      });
      chrome.storage.sync.get.mockImplementation(async (key) => (
        key === 'settings'
          ? {
            settings: {
              customColors: [],
              minimapVisible: true,
              selectionControlsVisible: true,
              oneClickHighlightEnabled: true,
            },
          }
          : {}
      ));

      await migrateLocalToSync();

      expect(local.oneClickHighlightEnabled).toBe(true);
      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ oneClickHighlightEnabled: true }),
        }),
      );
    });

    it('does not turn "nobody chose one" into a local value during migration', async () => {
      // Browser sync carries settings from a version that predates the setting.
      // Materializing the default here would give this device a `false` with a
      // fresh settings timestamp, which then beats an older cloud snapshot that
      // has the setting on.
      const local = {};
      chrome.storage.local.get.mockImplementation(async (keys) => {
        if (keys === null) return { ...local };
        const wanted = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(
          wanted.filter(key => key in local).map(key => [key, local[key]])
        );
      });
      chrome.storage.local.set.mockImplementation(async (items) => {
        Object.assign(local, items);
      });
      chrome.storage.sync.get.mockImplementation(async (key) => (
        key === 'settings'
          ? { settings: { customColors: [], minimapVisible: true, selectionControlsVisible: true } }
          : {}
      ));

      await migrateLocalToSync();

      expect(local).not.toHaveProperty('oneClickHighlightEnabled');
      const [[written]] = chrome.storage.sync.set.mock.calls;
      expect(written.settings).not.toHaveProperty('oneClickHighlightEnabled');
    });

    // The settings service loaded its in-memory copy and built the context menu
    // before the migration ran, and writing back what sync already holds raises
    // no change event. Startup applies what this returns; without it the menu
    // keeps the defaults another device hid.
    it('returns the settings it adopted from sync so startup can apply them', async () => {
      const local = {};
      chrome.storage.local.get.mockImplementation(async (keys) => {
        if (keys === null) return { ...local };
        const wanted = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(
          wanted.filter(key => key in local).map(key => [key, local[key]])
        );
      });
      chrome.storage.local.set.mockImplementation(async (items) => {
        Object.assign(local, items);
      });
      chrome.storage.sync.get.mockImplementation(async (key) => (
        key === 'settings'
          ? {
            settings: {
              customColors: [{ id: 'custom_1', colorNumber: 1, color: '#123456' }],
              minimapVisible: true,
              selectionControlsVisible: true,
              hideDefaultColors: true,
            },
          }
          : {}
      ));

      const adopted = await migrateLocalToSync();

      expect(local.hideDefaultColors).toBe(true);
      expect(adopted).toEqual(expect.objectContaining({
        hideDefaultColors: true,
        customColors: [expect.objectContaining({ id: 'custom_1' })],
      }));
    });

    it('returns nothing to apply once the migration has run', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({ syncMigrationDone: true });

      expect(await migrateLocalToSync()).toBeNull();
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

  // ===================================================================
  // storage.sync quota
  // ===================================================================

  // Backed by real objects that enforce storage.sync's quotas, so a write that
  // would fail in the browser fails here too instead of being waved through.
  describe('storage.sync quota', () => {
    const QUOTA_BYTES = 102400;
    const QUOTA_BYTES_PER_ITEM = 8192;
    const encoder = new TextEncoder();
    const itemBytes = (key, value) => encoder.encode(JSON.stringify({ [key]: value })).byteLength;

    let local;
    let sync;
    let saved;

    function select(store, keys) {
      if (keys === null || keys === undefined) return { ...store };
      const wanted = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.filter(key => key in store).map(key => [key, store[key]]));
    }

    beforeEach(() => {
      saved = ['get', 'set', 'remove'].flatMap(method => [
        [chrome.storage.local, method, chrome.storage.local[method].getMockImplementation()],
        [chrome.storage.sync, method, chrome.storage.sync[method].getMockImplementation()],
      ]);
      local = {};
      sync = {};

      chrome.storage.local.get.mockImplementation(async keys => select(local, keys));
      chrome.storage.local.set.mockImplementation(async items => { Object.assign(local, items); });
      chrome.storage.local.remove.mockImplementation(async keys => {
        (Array.isArray(keys) ? keys : [keys]).forEach(key => { delete local[key]; });
      });

      chrome.storage.sync.get.mockImplementation(async keys => select(sync, keys));
      chrome.storage.sync.set.mockImplementation(async items => {
        const next = { ...sync, ...items };
        for (const [key, value] of Object.entries(items)) {
          if (itemBytes(key, value) > QUOTA_BYTES_PER_ITEM) {
            throw new Error(`QUOTA_BYTES_PER_ITEM quota exceeded: ${key}`);
          }
        }
        const total = Object.entries(next).reduce((sum, [key, value]) => sum + itemBytes(key, value), 0);
        if (total > QUOTA_BYTES) throw new Error('QUOTA_BYTES quota exceeded');
        Object.assign(sync, items);
      });
      chrome.storage.sync.remove.mockImplementation(async keys => {
        (Array.isArray(keys) ? keys : [keys]).forEach(key => { delete sync[key]; });
      });
    });

    afterEach(() => {
      saved.forEach(([area, method, impl]) => area[method].mockImplementation(impl));
    });

    const urlFor = i => `https://www.example.com/blog/2026/11/an-article-title-number-${i}`;

    function highlightsOfSize(textLength, id = 'g') {
      return [{ groupId: id, color: '#ffd54f', text: 'x'.repeat(textLength), updatedAt: Date.now() }];
    }

    function savePage(i, textLength = 200, lastUpdated = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()) {
      return syncSaveHighlights(urlFor(i), highlightsOfSize(textLength, `g${i}`), `Title ${i}`, lastUpdated);
    }

    function syncedUrls() {
      return Object.entries(sync)
        .filter(([key]) => key.startsWith('hl_'))
        .map(([, data]) => data.url);
    }

    it('keeps syncing pages past the point where a page list in sync_meta outgrew its item', async () => {
      // About 55 pages filled the old list's 8KB; small pages fit the budget well past that.
      for (let i = 0; i < 120; i += 1) await savePage(i);

      expect(syncedUrls()).toHaveLength(120);
      expect(sync.sync_meta).toBeUndefined();
    });

    it('lists the synced pages from the items themselves, oldest first', async () => {
      await savePage(2);
      await savePage(1);

      const pages = await getSyncedPages();

      expect(pages.map(page => page.url)).toEqual([urlFor(1), urlFor(2)]);
      expect(pages[0].size).toBe(itemBytes(pages[0].syncKey, sync[pages[0].syncKey]));
    });

    it('does not evict another page to make room for the old copy of the page being updated', async () => {
      // Twelve pages near 7KB each sit just under the 90KB budget, so counting
      // the updated page's old copy alongside its new one would push it over.
      for (let i = 0; i < 12; i += 1) await savePage(i, 6900);
      expect(syncedUrls()).toHaveLength(12);

      await savePage(5, 6900, new Date(Date.UTC(2026, 5, 1)).toISOString());

      expect(syncedUrls()).toHaveLength(12);
      expect(chrome.storage.sync.remove).not.toHaveBeenCalled();
    });

    it('never evicts the page it is saving, even when that page is the oldest', async () => {
      for (let i = 0; i < 12; i += 1) await savePage(i, 6900);

      await savePage(0, 6900, new Date(Date.UTC(2026, 5, 1)).toISOString());

      expect(chrome.storage.sync.remove).not.toHaveBeenCalled();
      expect(syncedUrls()).toContain(urlFor(0));
    });

    it('still evicts the oldest other page when a new page needs the room', async () => {
      for (let i = 0; i < 12; i += 1) await savePage(i, 6900);

      await savePage(99, 6900, new Date(Date.UTC(2026, 5, 1)).toISOString());

      expect(syncedUrls()).not.toContain(urlFor(0));
      expect(syncedUrls()).toContain(urlFor(99));
    });

    it('clears a url tombstone when the page is saved again', async () => {
      sync.sync_meta = { deletedUrls: { [urlFor(1)]: Date.now() - 1000, [urlFor(2)]: Date.now() - 1000 } };

      await savePage(1);

      expect(Object.keys(sync.sync_meta.deletedUrls)).toEqual([urlFor(2)]);
    });

    it('works on a sync_meta an older version left with a full page list', async () => {
      sync.sync_meta = {
        pages: Array.from({ length: 50 }, (_, i) => ({ syncKey: `hl_old${i}`, url: urlFor(1000 + i), lastUpdated: '', size: 100 })),
        totalSize: 5000,
        deletedUrls: { [urlFor(1)]: Date.now() - 1000 },
      };

      await savePage(1);

      expect(syncedUrls()).toEqual([urlFor(1)]);
      expect(sync.sync_meta).toEqual({ deletedUrls: {} });
    });

    it('removes a deleted page and leaves a tombstone for the other devices', async () => {
      await savePage(1);

      await syncRemoveHighlights(urlFor(1));

      expect(syncedUrls()).toEqual([]);
      expect(Object.keys(sync.sync_meta.deletedUrls)).toEqual([urlFor(1)]);
    });

    it('removes a deleted page even when its tombstone cannot be written', async () => {
      await savePage(1);
      const set = chrome.storage.sync.set.getMockImplementation();
      chrome.storage.sync.set.mockImplementation(async items => {
        if ('sync_meta' in items) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
        return set(items);
      });

      await syncRemoveHighlights(urlFor(1));

      expect(syncedUrls()).toEqual([]);
    });

    it('writes nothing to sync for a page that was never there', async () => {
      await syncRemoveHighlights(urlFor(1));

      expect(chrome.storage.sync.set).not.toHaveBeenCalled();
      expect(chrome.storage.sync.remove).not.toHaveBeenCalled();
    });

    it('keeps the newest tombstones that fit in the meta item', () => {
      const now = Date.now();
      const deletedUrls = Object.fromEntries(
        Array.from({ length: 300 }, (_, i) => [urlFor(i), now - (300 - i) * 1000]),
      );

      const fitted = fitSyncMeta({ deletedUrls });

      expect(itemBytes('sync_meta', fitted)).toBeLessThanOrEqual(QUOTA_BYTES_PER_ITEM);
      expect(Object.keys(fitted.deletedUrls)).toContain(urlFor(299));
      expect(Object.keys(fitted.deletedUrls)).not.toContain(urlFor(0));
    });

    it('clears every synced page, however many there are', async () => {
      const now = 1700000000000;
      for (let i = 0; i < 120; i += 1) await savePage(i);
      jest.spyOn(Date, 'now').mockReturnValue(now);

      await clearAllSyncedHighlights(Array.from({ length: 120 }, (_, i) => urlFor(i)));

      Date.now.mockRestore();
      expect(syncedUrls()).toEqual([]);
      expect(Object.keys(sync.sync_meta.deletedUrls).length).toBeGreaterThan(50);
      expect(Object.values(sync.sync_meta.deletedUrls).every(deletedAt => deletedAt === now)).toBe(true);
    });

    it('pulls in every synced page on a new device, with or without a page list in sync_meta', async () => {
      sync[urlToSyncKey(urlFor(7))] = {
        url: urlFor(7),
        title: 'From another device',
        lastUpdated: '2026-01-01T00:00:00.000Z',
        highlights: highlightsOfSize(20, 'remote'),
        deletedGroupIds: {},
      };

      await migrateLocalToSync();

      expect(local[urlFor(7)].map(group => group.groupId)).toEqual(['remote']);
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
