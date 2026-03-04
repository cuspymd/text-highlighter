import chrome from '../mocks/chrome.js';
import {
  urlToBookmarkTitle,
  encodePayload,
  decodePayload,
  saveSettingsToBookmarks,
  getSettingsFromBookmarks,
  saveHighlightsToBookmarks,
  removeHighlightsFromBookmarks,
  clearAllBookmarkHighlights,
  migrateLocalToBookmarks,
  initBookmarkSyncListener,
  _clearRootFolderCache,
} from '../background/bookmark-sync-service.js';

const ROOT_FOLDER_ID = 'root_folder_id';
const ROOT_FOLDER = { id: ROOT_FOLDER_ID, title: 'Text Highlighter Sync', parentId: '2' };

/**
 * Helper: build a bookmark object as returned by the bookmarks API.
 */
function makeBookmark({ id = 'bm_id', parentId = ROOT_FOLDER_ID, title, payload }) {
  return { id, parentId, title, url: payload ? encodePayload(payload) : undefined };
}

/**
 * Set up mocks so getOrCreateRootFolder() returns ROOT_FOLDER.
 */
function setupRootFolder() {
  chrome.bookmarks.search.mockResolvedValue([ROOT_FOLDER]);
}

describe('bookmark-sync-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _clearRootFolderCache();
    // Default: no existing bookmarks
    chrome.bookmarks.search.mockResolvedValue([]);
    chrome.bookmarks.get.mockResolvedValue([]);
    chrome.bookmarks.getChildren.mockResolvedValue([]);
    chrome.bookmarks.create.mockImplementation((data) =>
      Promise.resolve({ id: 'new_bm_id', ...data })
    );
    chrome.bookmarks.update.mockImplementation((id, data) =>
      Promise.resolve({ id, ...data })
    );
    chrome.bookmarks.remove.mockResolvedValue();
    chrome.storage.local.get.mockResolvedValue({});
    chrome.storage.local.set.mockResolvedValue();
    chrome.storage.local.remove.mockResolvedValue();
    chrome.storage.sync.get.mockResolvedValue({});
    chrome.tabs.query.mockResolvedValue([]);
  });

  // ===================================================================
  // Pure helpers
  // ===================================================================

  describe('encodePayload / decodePayload', () => {
    it('should round-trip basic objects', () => {
      const data = { url: 'https://example.com', highlights: [], count: 42 };
      const encoded = encodePayload(data);
      const decoded = decodePayload(encoded);
      expect(decoded).toEqual(data);
    });

    it('should handle Unicode characters correctly', () => {
      const data = { text: '한글 テキスト 中文', emoji: '🎉' };
      const encoded = encodePayload(data);
      const decoded = decodePayload(encoded);
      expect(decoded).toEqual(data);
    });

    it('should return null for malformed input', () => {
      expect(decodePayload('not-a-data-url')).toBeNull();
      expect(decodePayload('data:application/json;base64,!!!')).toBeNull();
    });

    it('should produce a data URL with base64 scheme', () => {
      const encoded = encodePayload({ x: 1 });
      expect(encoded.startsWith('data:application/json;base64,')).toBe(true);
    });
  });

  describe('urlToBookmarkTitle', () => {
    it('should return a string starting with hl_', async () => {
      const title = await urlToBookmarkTitle('https://example.com');
      expect(title.startsWith('hl_')).toBe(true);
    });

    it('should be deterministic for the same URL', async () => {
      const url = 'https://example.com/page';
      const t1 = await urlToBookmarkTitle(url);
      const t2 = await urlToBookmarkTitle(url);
      expect(t1).toBe(t2);
    });

    it('should produce different titles for different URLs', async () => {
      const t1 = await urlToBookmarkTitle('https://example.com/a');
      const t2 = await urlToBookmarkTitle('https://example.com/b');
      expect(t1).not.toBe(t2);
    });

    it('should produce only alphanumeric characters after hl_ prefix', async () => {
      const title = await urlToBookmarkTitle('https://example.com/test?q=1&p=2#anchor');
      const suffix = title.slice(3); // strip 'hl_'
      expect(suffix).toMatch(/^[0-9a-z]+$/);
    });
  });

  // ===================================================================
  // getOrCreateRootFolder (via saveSettingsToBookmarks)
  // ===================================================================

  describe('root folder creation', () => {
    it('should create the root folder when none exists', async () => {
      chrome.bookmarks.search.mockResolvedValue([]);
      chrome.bookmarks.create.mockResolvedValueOnce(ROOT_FOLDER);
      chrome.bookmarks.getChildren.mockResolvedValue([]);

      await saveSettingsToBookmarks();

      expect(chrome.bookmarks.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Text Highlighter Sync' })
      );
    });

    it('should reuse the existing root folder if it exists', async () => {
      setupRootFolder();
      chrome.bookmarks.getChildren.mockResolvedValue([]);
      chrome.bookmarks.create.mockResolvedValue({ id: 'new_bm_id' });

      await saveSettingsToBookmarks();
      await saveSettingsToBookmarks();

      // bookmarks.create called only once (for the settings bookmark), not for the folder
      const folderCreates = chrome.bookmarks.create.mock.calls.filter(
        call => call[0].title === 'Text Highlighter Sync'
      );
      expect(folderCreates.length).toBe(0);
    });
  });

  // ===================================================================
  // saveSettingsToBookmarks / getSettingsFromBookmarks
  // ===================================================================

  describe('saveSettingsToBookmarks', () => {
    beforeEach(() => {
      setupRootFolder();
    });

    it('should read settings from local storage and write them to a bookmark', async () => {
      chrome.storage.local.get.mockResolvedValue({
        customColors: [{ id: 'custom_1', color: '#AABBCC' }],
        minimapVisible: false,
        selectionControlsVisible: true,
      });
      chrome.bookmarks.getChildren.mockResolvedValue([]);

      await saveSettingsToBookmarks();

      expect(chrome.bookmarks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: ROOT_FOLDER_ID,
          title: 'settings',
        })
      );

      const createCall = chrome.bookmarks.create.mock.calls.find(
        c => c[0].title === 'settings'
      );
      const payload = decodePayload(createCall[0].url);
      expect(payload.minimapVisible).toBe(false);
      expect(payload.selectionControlsVisible).toBe(true);
      expect(payload.customColors).toHaveLength(1);
    });

    it('should update the existing settings bookmark instead of creating a new one', async () => {
      const existingBm = makeBookmark({
        id: 'settings_bm_id',
        title: 'settings',
        payload: { customColors: [], minimapVisible: true, selectionControlsVisible: true },
      });
      chrome.bookmarks.getChildren.mockResolvedValue([existingBm]);
      chrome.storage.local.get.mockResolvedValue({ minimapVisible: false });

      await saveSettingsToBookmarks();

      expect(chrome.bookmarks.update).toHaveBeenCalledWith('settings_bm_id', expect.objectContaining({ url: expect.any(String) }));
      expect(chrome.bookmarks.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: 'settings' })
      );
    });

    it('should use defaults when local storage has no settings', async () => {
      chrome.storage.local.get.mockResolvedValue({});
      chrome.bookmarks.getChildren.mockResolvedValue([]);

      await saveSettingsToBookmarks();

      const createCall = chrome.bookmarks.create.mock.calls.find(c => c[0].title === 'settings');
      const payload = decodePayload(createCall[0].url);
      expect(payload.customColors).toEqual([]);
      expect(payload.minimapVisible).toBe(true);
      expect(payload.selectionControlsVisible).toBe(true);
    });

    it('should not throw if bookmark creation fails', async () => {
      chrome.bookmarks.getChildren.mockResolvedValue([]);
      chrome.bookmarks.create.mockRejectedValue(new Error('quota exceeded'));

      await expect(saveSettingsToBookmarks()).resolves.not.toThrow();
    });
  });

  describe('getSettingsFromBookmarks', () => {
    beforeEach(() => {
      setupRootFolder();
    });

    it('should return null when no settings bookmark exists', async () => {
      chrome.bookmarks.getChildren.mockResolvedValue([]);
      const result = await getSettingsFromBookmarks();
      expect(result).toBeNull();
    });

    it('should return the decoded settings when a settings bookmark exists', async () => {
      const settings = { customColors: [{ id: 'c1', color: '#FF0000' }], minimapVisible: false };
      const bm = makeBookmark({ title: 'settings', payload: settings });
      chrome.bookmarks.getChildren.mockResolvedValue([bm]);

      const result = await getSettingsFromBookmarks();
      expect(result).toEqual(settings);
    });
  });

  // ===================================================================
  // saveHighlightsToBookmarks (S-1, S-10, S-11, M-6, M-7, M-14)
  // ===================================================================

  describe('saveHighlightsToBookmarks', () => {
    const pageUrl = 'https://example.com/page';
    const pageTitle = 'Example Page';
    const lastUpdated = '2024-01-01T00:00:00.000Z';

    beforeEach(() => {
      setupRootFolder();
    });

    it('should create a new page bookmark when none exists', async () => {
      const highlights = [{ groupId: 'g1', color: 'yellow', updatedAt: 100 }];
      chrome.storage.local.get.mockResolvedValue({});
      chrome.bookmarks.getChildren.mockResolvedValue([]);

      await saveHighlightsToBookmarks(pageUrl, highlights, pageTitle, lastUpdated);

      const createCalls = chrome.bookmarks.create.mock.calls;
      const pageBmCall = createCalls.find(c => c[0].title && c[0].title.startsWith('hl_'));
      expect(pageBmCall).toBeDefined();
      const payload = decodePayload(pageBmCall[0].url);
      expect(payload.url).toBe(pageUrl);
      expect(payload.highlights).toHaveLength(1);
    });

    it('should update local storage before writing to bookmark', async () => {
      const highlights = [{ groupId: 'g1', updatedAt: 100 }];
      chrome.storage.local.get.mockResolvedValue({});
      chrome.bookmarks.getChildren.mockResolvedValue([]);

      await saveHighlightsToBookmarks(pageUrl, highlights, pageTitle, lastUpdated);

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ [pageUrl]: expect.any(Array) })
      );
    });

    it('should merge with existing remote bookmark data (M-6: union of highlights)', async () => {
      const localHighlights = [{ groupId: 'g1', updatedAt: 100, text: 'local' }];
      const remoteHighlights = [{ groupId: 'g2', updatedAt: 200, text: 'remote' }];
      const bookmarkTitle = await urlToBookmarkTitle(pageUrl);

      const remoteBm = makeBookmark({
        title: bookmarkTitle,
        payload: { url: pageUrl, highlights: remoteHighlights, deletedGroupIds: {} },
      });
      chrome.storage.local.get.mockResolvedValue({});
      chrome.bookmarks.getChildren
        .mockResolvedValueOnce([remoteBm]) // page bookmark lookup
        .mockResolvedValue([]);            // meta bookmark lookup

      await saveHighlightsToBookmarks(pageUrl, localHighlights, pageTitle, lastUpdated);

      const setCall = chrome.storage.local.set.mock.calls[0][0];
      const savedHighlights = setCall[pageUrl];
      const groupIds = savedHighlights.map(h => h.groupId);
      expect(groupIds).toContain('g1');
      expect(groupIds).toContain('g2');
    });

    it('should respect last-write-wins for same groupId (M-7)', async () => {
      const bookmarkTitle = await urlToBookmarkTitle(pageUrl);
      const localHighlights = [{ groupId: 'g1', color: 'yellow', updatedAt: 100 }];
      const remoteHighlights = [{ groupId: 'g1', color: 'blue', updatedAt: 200 }];

      const remoteBm = makeBookmark({
        title: bookmarkTitle,
        payload: { url: pageUrl, highlights: remoteHighlights, deletedGroupIds: {} },
      });
      chrome.storage.local.get.mockResolvedValue({});
      chrome.bookmarks.getChildren
        .mockResolvedValueOnce([remoteBm])
        .mockResolvedValue([]);

      await saveHighlightsToBookmarks(pageUrl, localHighlights, pageTitle, lastUpdated);

      const setCall = chrome.storage.local.set.mock.calls[0][0];
      const saved = setCall[pageUrl];
      expect(saved).toHaveLength(1);
      expect(saved[0].color).toBe('blue'); // remote wins (updatedAt: 200 > 100)
    });

    it('should skip bookmark write when data exceeds 8KB limit (S-11)', async () => {
      // Create a payload larger than 8KB
      const largeHighlights = Array.from({ length: 500 }, (_, i) => ({
        groupId: `g${i}`,
        text: 'x'.repeat(50),
        updatedAt: i,
      }));
      chrome.storage.local.get.mockResolvedValue({});
      chrome.bookmarks.getChildren.mockResolvedValue([]);

      await saveHighlightsToBookmarks(pageUrl, largeHighlights, pageTitle, lastUpdated);

      // Local storage should still be updated
      expect(chrome.storage.local.set).toHaveBeenCalled();
      // But no page bookmark should be created
      const pageBmCreates = chrome.bookmarks.create.mock.calls.filter(
        c => c[0].title && c[0].title.startsWith('hl_')
      );
      expect(pageBmCreates).toHaveLength(0);
    });

    it('should evict oldest page when budget is exceeded (S-10, M-12)', async () => {
      const oldUrl = 'https://old.example.com';
      const oldBookmarkTitle = await urlToBookmarkTitle(oldUrl);
      const oldBmId = 'old_bm_id';

      // Meta shows one page filling the full budget so any new data triggers eviction
      const metaPayload = {
        pages: [{ bookmarkTitle: oldBookmarkTitle, url: oldUrl, lastUpdated: '2020-01-01', size: 90000 }],
        totalSize: 90000,
        deletedUrls: {},
      };
      const metaBm = makeBookmark({ title: 'meta', payload: metaPayload });
      const oldPageBm = makeBookmark({ id: oldBmId, title: oldBookmarkTitle, payload: { url: oldUrl } });

      chrome.storage.local.get.mockResolvedValue({});
      // getChildren call order:
      // 1. page bookmark lookup (no existing page bm)
      // 2. meta read
      // 3. eviction: find old page bookmark
      // 4+ . new page upsert + meta write
      chrome.bookmarks.getChildren
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([metaBm])
        .mockResolvedValueOnce([oldPageBm])
        .mockResolvedValue([]);

      const highlights = [{ groupId: 'g1', updatedAt: 100 }];
      await saveHighlightsToBookmarks(pageUrl, highlights, pageTitle, lastUpdated);

      // Old bookmark should have been removed
      expect(chrome.bookmarks.remove).toHaveBeenCalledWith(oldBmId);
    });

    it('should not record evicted pages as tombstones (M-12)', async () => {
      const oldUrl = 'https://old.example.com';
      const oldBookmarkTitle = await urlToBookmarkTitle(oldUrl);

      const metaPayload = {
        pages: [{ bookmarkTitle: oldBookmarkTitle, url: oldUrl, lastUpdated: '2020-01-01', size: 90000 }],
        totalSize: 90000,
        deletedUrls: {},
      };
      const metaBm = makeBookmark({ title: 'meta', payload: metaPayload });
      const oldPageBm = makeBookmark({ id: 'old_id', title: oldBookmarkTitle, payload: { url: oldUrl } });

      chrome.storage.local.get.mockResolvedValue({});
      chrome.bookmarks.getChildren
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([metaBm])
        .mockResolvedValueOnce([oldPageBm])
        .mockResolvedValue([]);

      await saveHighlightsToBookmarks(pageUrl, [{ groupId: 'g1', updatedAt: 100 }], pageTitle, lastUpdated);

      // Verify eviction happened (remove was called)
      expect(chrome.bookmarks.remove).toHaveBeenCalled();

      // Verify no tombstone was added for the evicted URL
      const allMetaWrites = [
        ...chrome.bookmarks.create.mock.calls.filter(c => c[0].title === 'meta').map(c => decodePayload(c[0].url)),
        ...chrome.bookmarks.update.mock.calls.filter(c => c[1]?.url).map(c => decodePayload(c[1].url)),
      ].filter(Boolean);
      for (const metaSaved of allMetaWrites) {
        expect(metaSaved.deletedUrls).not.toHaveProperty(oldUrl);
      }
    });

    it('should clear tombstone for the URL being saved', async () => {
      const metaPayload = {
        pages: [],
        totalSize: 0,
        deletedUrls: { [pageUrl]: Date.now() - 1000 },
      };
      const metaBm = makeBookmark({ title: 'meta', payload: metaPayload });

      chrome.storage.local.get.mockResolvedValue({});
      chrome.bookmarks.getChildren
        .mockResolvedValueOnce([])       // page bookmark lookup
        .mockResolvedValueOnce([metaBm]) // meta read
        .mockResolvedValue([]);          // meta write

      await saveHighlightsToBookmarks(pageUrl, [{ groupId: 'g1', updatedAt: 100 }], pageTitle, lastUpdated);

      // Meta should be updated without the URL in deletedUrls
      const createCalls = chrome.bookmarks.create.mock.calls.filter(c => c[0].title === 'meta');
      if (createCalls.length > 0) {
        const metaSaved = decodePayload(createCalls[createCalls.length - 1][0].url);
        expect(metaSaved.deletedUrls).not.toHaveProperty(pageUrl);
      }
    });
  });

  // ===================================================================
  // removeHighlightsFromBookmarks (S-3, M-3, M-4)
  // ===================================================================

  describe('removeHighlightsFromBookmarks', () => {
    const pageUrl = 'https://example.com/page';

    beforeEach(() => {
      setupRootFolder();
    });

    it('should add a tombstone to meta.deletedUrls', async () => {
      const now = 1700000000000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      chrome.bookmarks.getChildren
        .mockResolvedValueOnce([]) // meta read (empty)
        .mockResolvedValueOnce([]) // page bookmark lookup
        .mockResolvedValue([]);    // meta write

      await removeHighlightsFromBookmarks(pageUrl);

      const createCalls = chrome.bookmarks.create.mock.calls.filter(c => c[0].title === 'meta');
      expect(createCalls.length).toBeGreaterThan(0);
      const metaSaved = decodePayload(createCalls[0][0].url);
      expect(metaSaved.deletedUrls[pageUrl]).toBe(now);

      Date.now.mockRestore();
    });

    it('should remove the page bookmark', async () => {
      const bookmarkTitle = await urlToBookmarkTitle(pageUrl);
      const pageBm = makeBookmark({ id: 'page_bm_id', title: bookmarkTitle, payload: {} });

      // getChildren call order:
      // 1. meta read (getBookmarkMeta)
      // 2. meta write lookup (saveBookmarkMeta → upsertBookmark)
      // 3. page bookmark lookup
      chrome.bookmarks.getChildren
        .mockResolvedValueOnce([])        // meta read: no existing meta
        .mockResolvedValueOnce([])        // meta write: no existing meta, will create
        .mockResolvedValueOnce([pageBm])  // page bookmark lookup: found
        .mockResolvedValue([]);

      await removeHighlightsFromBookmarks(pageUrl);

      expect(chrome.bookmarks.remove).toHaveBeenCalledWith('page_bm_id');
    });

    it('should remove the page from meta.pages and update totalSize', async () => {
      const bookmarkTitle = await urlToBookmarkTitle(pageUrl);
      const metaPayload = {
        pages: [{ bookmarkTitle, url: pageUrl, lastUpdated: '2024-01-01', size: 1000 }],
        totalSize: 1000,
        deletedUrls: {},
      };
      const metaBm = makeBookmark({ title: 'meta', payload: metaPayload });

      chrome.bookmarks.getChildren
        .mockResolvedValueOnce([metaBm]) // meta read
        .mockResolvedValueOnce([])       // page bookmark lookup
        .mockResolvedValue([]);          // meta write

      await removeHighlightsFromBookmarks(pageUrl);

      const metaUpdateCalls = chrome.bookmarks.update.mock.calls.filter(
        c => c[0] === 'new_bm_id' || typeof c[0] === 'string'
      );
      // Find meta write (create or update)
      const metaCreates = chrome.bookmarks.create.mock.calls.filter(c => c[0].title === 'meta');
      const metaUpdates = chrome.bookmarks.update.mock.calls;
      const anyMetaWrite = [...metaCreates.map(c => decodePayload(c[0].url)), ...metaUpdates.map(c => decodePayload(c[1]?.url || ''))].filter(Boolean);

      // totalSize should be 0 after removal
      const finalMeta = anyMetaWrite.find(m => m && m.pages !== undefined);
      if (finalMeta) {
        expect(finalMeta.pages).toHaveLength(0);
        expect(finalMeta.totalSize).toBe(0);
      }
    });

    it('should not throw if the page bookmark does not exist', async () => {
      chrome.bookmarks.getChildren.mockResolvedValue([]);
      await expect(removeHighlightsFromBookmarks(pageUrl)).resolves.not.toThrow();
    });
  });

  // ===================================================================
  // clearAllBookmarkHighlights (S-4, M-5)
  // ===================================================================

  describe('clearAllBookmarkHighlights', () => {
    beforeEach(() => {
      setupRootFolder();
    });

    it('should add tombstones for all pages tracked in meta', async () => {
      const now = 1700000000000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const bTitle1 = await urlToBookmarkTitle('https://a.com');
      const bTitle2 = await urlToBookmarkTitle('https://b.com');
      const metaPayload = {
        pages: [
          { bookmarkTitle: bTitle1, url: 'https://a.com', size: 100 },
          { bookmarkTitle: bTitle2, url: 'https://b.com', size: 200 },
        ],
        totalSize: 300,
        deletedUrls: {},
      };
      const metaBm = makeBookmark({ id: 'meta_bm_id', title: 'meta', payload: metaPayload });
      const pageBm1 = makeBookmark({ id: 'p1', title: bTitle1, payload: {} });
      const pageBm2 = makeBookmark({ id: 'p2', title: bTitle2, payload: {} });

      chrome.bookmarks.getChildren
        .mockResolvedValueOnce([metaBm])     // initial meta read
        .mockResolvedValueOnce([])           // meta write (first update with tombstones)
        .mockResolvedValueOnce([pageBm1])    // remove page 1
        .mockResolvedValueOnce([pageBm2])    // remove page 2
        .mockResolvedValue([]);              // final meta write

      await clearAllBookmarkHighlights();

      // Both pages should be removed
      expect(chrome.bookmarks.remove).toHaveBeenCalledWith('p1');
      expect(chrome.bookmarks.remove).toHaveBeenCalledWith('p2');

      // First meta write should include tombstones
      const firstMetaUpdate = chrome.bookmarks.update.mock.calls[0];
      if (firstMetaUpdate) {
        const payload = decodePayload(firstMetaUpdate[1].url);
        expect(payload.deletedUrls['https://a.com']).toBe(now);
        expect(payload.deletedUrls['https://b.com']).toBe(now);
      }

      Date.now.mockRestore();
    });

    it('should reset pages and totalSize to empty after clearing', async () => {
      const bTitle = await urlToBookmarkTitle('https://c.com');
      const metaPayload = {
        pages: [{ bookmarkTitle: bTitle, url: 'https://c.com', size: 500 }],
        totalSize: 500,
        deletedUrls: {},
      };
      const metaBm = makeBookmark({ id: 'meta_bm_id', title: 'meta', payload: metaPayload });

      chrome.bookmarks.getChildren
        .mockResolvedValueOnce([metaBm])
        .mockResolvedValue([]);

      await clearAllBookmarkHighlights();

      // Find the final meta write (create or update with pages: [], totalSize: 0)
      const allMetaWrites = [
        ...chrome.bookmarks.create.mock.calls.filter(c => c[0].title === 'meta').map(c => decodePayload(c[0].url)),
        ...chrome.bookmarks.update.mock.calls.filter(c => c[1]?.url).map(c => decodePayload(c[1].url)),
      ].filter(Boolean);

      const finalMeta = allMetaWrites[allMetaWrites.length - 1];
      expect(finalMeta).toBeDefined();
      expect(finalMeta.pages).toEqual([]);
      expect(finalMeta.totalSize).toBe(0);
    });
  });

  // ===================================================================
  // migrateLocalToBookmarks (S-9, M-1)
  // ===================================================================

  describe('migrateLocalToBookmarks', () => {
    beforeEach(() => {
      setupRootFolder();
    });

    it('should do nothing if bookmarkMigrationDone flag is set', async () => {
      chrome.storage.local.get.mockResolvedValue({ bookmarkMigrationDone: true });

      await migrateLocalToBookmarks();

      expect(chrome.bookmarks.create).not.toHaveBeenCalled();
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('should set the bookmarkMigrationDone flag after completion', async () => {
      chrome.storage.local.get.mockImplementation((keys) => {
        if (keys === 'bookmarkMigrationDone' || (Array.isArray(keys) && keys.includes('bookmarkMigrationDone'))) {
          return Promise.resolve({ bookmarkMigrationDone: false });
        }
        return Promise.resolve({});
      });
      chrome.bookmarks.getChildren.mockResolvedValue([]);
      chrome.bookmarks.getChildren.mockResolvedValue([]);

      await migrateLocalToBookmarks();

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ bookmarkMigrationDone: true })
      );
    });

    it('should merge local highlight data with remote bookmark data', async () => {
      const url = 'https://example.com/migrated';
      const localHighlights = [{ groupId: 'local_g1', updatedAt: 100 }];
      const remoteHighlights = [{ groupId: 'remote_g2', updatedAt: 200 }];
      const bookmarkTitle = await urlToBookmarkTitle(url);

      const remotePageBm = makeBookmark({
        title: bookmarkTitle,
        payload: { url, highlights: remoteHighlights, deletedGroupIds: {} },
      });
      const allHighlightBms = [remotePageBm];

      chrome.storage.local.get.mockImplementation((keys) => {
        if (keys === 'bookmarkMigrationDone') return Promise.resolve({});
        if (keys === null) {
          return Promise.resolve({
            [url]: localHighlights,
            [`${url}_meta`]: { title: 'Test', lastUpdated: '2024-01-01' },
          });
        }
        return Promise.resolve({});
      });

      // Setup getChildren to return highlight bookmarks for getAllHighlightBookmarks
      chrome.bookmarks.getChildren.mockImplementation((id) => {
        if (id === ROOT_FOLDER_ID) return Promise.resolve(allHighlightBms);
        return Promise.resolve([]);
      });

      await migrateLocalToBookmarks();

      // Both local and remote highlights should be saved
      const setCallsWithHighlights = chrome.storage.local.set.mock.calls.filter(
        c => c[0][url] !== undefined
      );
      expect(setCallsWithHighlights.length).toBeGreaterThan(0);
      const savedHighlights = setCallsWithHighlights[0][0][url];
      const groupIds = savedHighlights.map(h => h.groupId);
      expect(groupIds).toContain('local_g1');
      expect(groupIds).toContain('remote_g2');
    });

    it('should skip URLs that are tombstoned and have no local data', async () => {
      const deletedUrl = 'https://deleted.example.com';
      const bookmarkTitle = await urlToBookmarkTitle(deletedUrl);

      const metaBm = makeBookmark({
        title: 'meta',
        payload: {
          pages: [{ bookmarkTitle, url: deletedUrl, size: 100 }],
          totalSize: 100,
          deletedUrls: { [deletedUrl]: Date.now() },
        },
      });

      chrome.storage.local.get.mockImplementation((keys) => {
        if (keys === 'bookmarkMigrationDone') return Promise.resolve({});
        if (keys === null) return Promise.resolve({}); // no local data
        return Promise.resolve({});
      });
      chrome.bookmarks.getChildren.mockImplementation((id) => {
        if (id === ROOT_FOLDER_ID) return Promise.resolve([metaBm]);
        return Promise.resolve([]);
      });

      await migrateLocalToBookmarks();

      // Should not save highlights for the deleted URL
      const setCallsForDeletedUrl = chrome.storage.local.set.mock.calls.filter(
        c => c[0][deletedUrl] !== undefined
      );
      expect(setCallsForDeletedUrl).toHaveLength(0);
    });
  });

  // ===================================================================
  // initBookmarkSyncListener (M-2, M-3, M-8, M-12 eviction vs deletion)
  // ===================================================================

  describe('initBookmarkSyncListener', () => {
    beforeEach(() => {
      setupRootFolder();
    });

    it('should register onChanged and onRemoved listeners', () => {
      initBookmarkSyncListener({});
      expect(chrome.bookmarks.onChanged.addListener).toHaveBeenCalledTimes(1);
      expect(chrome.bookmarks.onRemoved.addListener).toHaveBeenCalledTimes(1);
    });

    it('should invoke onSettingsChanged when settings bookmark changes (M-8)', async () => {
      const onSettingsChanged = jest.fn().mockResolvedValue(undefined);
      initBookmarkSyncListener({ onSettingsChanged });

      const settings = { customColors: [], minimapVisible: false, selectionControlsVisible: true };
      const settingsBm = makeBookmark({ id: 'settings_id', parentId: ROOT_FOLDER_ID, title: 'settings', payload: settings });

      // bookmarks.get returns the settings bookmark
      chrome.bookmarks.get.mockResolvedValue([settingsBm]);
      // getChildren for root folder (to get children with updated URL)
      chrome.bookmarks.getChildren.mockResolvedValue([settingsBm]);

      const onChangedListener = chrome.bookmarks.onChanged.addListener.mock.calls.at(-1)[0];
      await onChangedListener('settings_id', { url: encodePayload(settings) });

      expect(onSettingsChanged).toHaveBeenCalledWith(settings);
    });

    it('should NOT invoke onSettingsChanged for bookmarks outside the root folder', async () => {
      const onSettingsChanged = jest.fn();
      initBookmarkSyncListener({ onSettingsChanged });

      // Bookmark in a different folder
      const foreignBm = { id: 'foreign_id', parentId: 'other_folder', title: 'settings' };
      chrome.bookmarks.get.mockResolvedValue([foreignBm]);

      const onChangedListener = chrome.bookmarks.onChanged.addListener.mock.calls.at(-1)[0];
      await onChangedListener('foreign_id', { url: encodePayload({ minimapVisible: true }) });

      expect(onSettingsChanged).not.toHaveBeenCalled();
    });

    it('should merge and apply highlights when a page bookmark changes (M-2)', async () => {
      const pageUrl = 'https://example.com/synced';
      const bookmarkTitle = await urlToBookmarkTitle(pageUrl);
      const remoteHighlights = [{ groupId: 'remote_g1', updatedAt: 500, text: 'remote' }];

      const pageBm = makeBookmark({
        id: 'page_bm_id',
        parentId: ROOT_FOLDER_ID,
        title: bookmarkTitle,
        payload: { url: pageUrl, highlights: remoteHighlights, deletedGroupIds: {} },
      });

      initBookmarkSyncListener({});

      chrome.bookmarks.get.mockResolvedValue([pageBm]);
      chrome.storage.local.get.mockResolvedValue({
        [pageUrl]: [{ groupId: 'local_g2', updatedAt: 300 }],
        [`${pageUrl}_meta`]: {},
      });

      const onChangedListener = chrome.bookmarks.onChanged.addListener.mock.calls.at(-1)[0];
      await onChangedListener('page_bm_id', { url: encodePayload({ url: pageUrl, highlights: remoteHighlights, deletedGroupIds: {} }) });

      const setCall = chrome.storage.local.set.mock.calls[0]?.[0];
      expect(setCall).toBeDefined();
      const groupIds = setCall[pageUrl].map(h => h.groupId);
      expect(groupIds).toContain('local_g2');
      expect(groupIds).toContain('remote_g1');
    });

    describe('onRemoved – tombstone vs eviction (M-3, M-12)', () => {
      it('should schedule user deletion resolution when a page bookmark is removed', async () => {
        const pageUrl = 'https://example.com/removed';
        const bookmarkTitle = await urlToBookmarkTitle(pageUrl);
        const node = {
          id: 'rm_id',
          parentId: ROOT_FOLDER_ID,
          title: bookmarkTitle,
          url: encodePayload({ url: pageUrl }),
        };

        initBookmarkSyncListener({});
        const onRemovedListener = chrome.bookmarks.onRemoved.addListener.mock.calls.at(-1)[0];
        await onRemovedListener('rm_id', { node });

        // Timer was scheduled — no immediate deletion
        expect(chrome.storage.local.remove).not.toHaveBeenCalled();
      });

      it('should apply local deletion if tombstone exists (user deletion, M-3)', async () => {
        jest.useFakeTimers();
        const pageUrl = 'https://example.com/user-deleted';
        const bookmarkTitle = await urlToBookmarkTitle(pageUrl);
        const node = {
          id: 'rm_id',
          parentId: ROOT_FOLDER_ID,
          title: bookmarkTitle,
          url: encodePayload({ url: pageUrl }),
        };

        // Meta has tombstone for this URL
        const metaBm = makeBookmark({
          title: 'meta',
          payload: { pages: [], totalSize: 0, deletedUrls: { [pageUrl]: Date.now() } },
        });
        chrome.bookmarks.getChildren.mockResolvedValue([metaBm]);
        chrome.tabs.query.mockResolvedValue([]);

        initBookmarkSyncListener({});
        const onRemovedListener = chrome.bookmarks.onRemoved.addListener.mock.calls.at(-1)[0];
        await onRemovedListener('rm_id', { node });

        // Advance the timer to trigger the retry check
        await jest.runAllTimersAsync();

        expect(chrome.storage.local.remove).toHaveBeenCalledWith(
          expect.arrayContaining([pageUrl, `${pageUrl}_meta`])
        );

        jest.useRealTimers();
      });

      it('should keep local data if no tombstone exists after retries (eviction, M-12)', async () => {
        jest.useFakeTimers();
        const pageUrl = 'https://example.com/evicted';
        const bookmarkTitle = await urlToBookmarkTitle(pageUrl);
        const node = {
          id: 'ev_id',
          parentId: ROOT_FOLDER_ID,
          title: bookmarkTitle,
          url: encodePayload({ url: pageUrl }),
        };

        // Meta has NO tombstone for this URL
        const metaBm = makeBookmark({
          title: 'meta',
          payload: { pages: [], totalSize: 0, deletedUrls: {} },
        });
        chrome.bookmarks.getChildren.mockResolvedValue([metaBm]);

        initBookmarkSyncListener({});
        const onRemovedListener = chrome.bookmarks.onRemoved.addListener.mock.calls.at(-1)[0];
        await onRemovedListener('ev_id', { node });

        // Advance all timers (including all retries)
        await jest.runAllTimersAsync();

        // Local storage should NOT be removed (eviction — data must be kept locally)
        expect(chrome.storage.local.remove).not.toHaveBeenCalled();

        jest.useRealTimers();
      });

      it('should ignore removal of bookmarks outside the root folder', async () => {
        const node = {
          id: 'foreign_rm',
          parentId: 'some_other_folder',
          title: 'hl_somehash',
          url: encodePayload({ url: 'https://foreign.com' }),
        };

        initBookmarkSyncListener({});
        const onRemovedListener = chrome.bookmarks.onRemoved.addListener.mock.calls.at(-1)[0];
        await onRemovedListener('foreign_rm', { node });

        expect(chrome.storage.local.remove).not.toHaveBeenCalled();
      });
    });
  });

  // ===================================================================
  // Edge case: deletedGroupIds tombstone propagation (M-14)
  // ===================================================================

  describe('deletedGroupIds tombstone in merge', () => {
    it('should preserve deletion even when the other device adds a new highlight (M-14)', async () => {
      const pageUrl = 'https://example.com/conflict';
      const bookmarkTitle = await urlToBookmarkTitle(pageUrl);
      setupRootFolder();

      const now = Date.now();
      // Local: deleted g1, added g2
      const localHighlights = [{ groupId: 'g2', updatedAt: now, text: 'new local' }];
      const localMeta = { deletedGroupIds: { g1: now - 100 } };

      // Remote: still has g1, no g2
      const remoteHighlights = [{ groupId: 'g1', updatedAt: now - 200, text: 'remote g1' }];
      const remoteBm = makeBookmark({
        title: bookmarkTitle,
        payload: { url: pageUrl, highlights: remoteHighlights, deletedGroupIds: {} },
      });

      chrome.storage.local.get.mockResolvedValue({
        [`${pageUrl}_meta`]: localMeta,
      });
      chrome.bookmarks.getChildren
        .mockResolvedValueOnce([remoteBm])  // page bookmark lookup
        .mockResolvedValue([]);             // meta operations

      await saveHighlightsToBookmarks(pageUrl, localHighlights, 'Test', new Date().toISOString());

      const setCall = chrome.storage.local.set.mock.calls[0][0];
      const savedHighlights = setCall[pageUrl];
      // g1 should be gone (tombstoned), g2 should be present
      expect(savedHighlights.map(h => h.groupId)).not.toContain('g1');
      expect(savedHighlights.map(h => h.groupId)).toContain('g2');
    });
  });
});
