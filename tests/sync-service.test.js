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
  syncSaveHighlights,
} from '../background/sync-service.js';

const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function parseBookmarkPayload(dataUrl) {
  const encoded = dataUrl.split('base64,')[1];
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
}

describe('sync-service (bookmark-based)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('cleanupTombstones', () => {
    it('removes tombstones older than 30 days', () => {
      const now = Date.now();
      const obj = {
        old: now - TOMBSTONE_RETENTION_MS - 1,
        fresh: now - TOMBSTONE_RETENTION_MS + 1,
      };
      cleanupTombstones(obj);
      expect(obj.old).toBeUndefined();
      expect(obj.fresh).toBeDefined();
    });
  });

  describe('normalizeSyncMeta', () => {
    it('returns normalized defaults', () => {
      expect(normalizeSyncMeta(null)).toEqual({ pages: [], totalSize: 0, deletedUrls: {} });
    });
  });

  describe('urlToSyncKey', () => {
    it('generates deterministic key with hl_ prefix', () => {
      const key = urlToSyncKey('https://example.com/page');
      expect(key).toBe(urlToSyncKey('https://example.com/page'));
      expect(key.startsWith('hl_')).toBe(true);
    });
  });

  describe('mergeHighlights', () => {
    it('merges distinct highlights', () => {
      const result = mergeHighlights(
        { highlights: [{ groupId: 'a', updatedAt: 1 }] },
        { highlights: [{ groupId: 'b', updatedAt: 2 }] },
      );
      expect(result.highlights).toHaveLength(2);
    });

    it('applies tombstones', () => {
      const now = Date.now();
      const result = mergeHighlights(
        { highlights: [{ groupId: 'a', updatedAt: now - 100 }], deletedGroupIds: { a: now - 10 } },
        { highlights: [] },
      );
      expect(result.highlights).toEqual([]);
    });
  });

  describe('saveSettingsToSync', () => {
    it('writes settings to bookmarks payload', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({
        customColors: [{ id: 'custom_1', color: '#AABBCC' }],
        minimapVisible: false,
        selectionControlsVisible: true,
      });

      chrome.bookmarks.search.mockResolvedValue([{ id: 'root-folder', title: 'Text Highlighter Sync' }]);
      chrome.bookmarks.getChildren.mockResolvedValue([]);

      await saveSettingsToSync();

      const settingsOp = [
        ...chrome.bookmarks.create.mock.calls.map(call => call[0]),
        ...chrome.bookmarks.update.mock.calls.map(call => call[1]),
      ].find(op => op && op.title === 'settings');

      expect(settingsOp).toBeDefined();
      expect(settingsOp).toEqual(expect.objectContaining({
        title: 'settings',
        url: expect.stringContaining('data:application/json;base64,'),
      }));

      const payload = parseBookmarkPayload(settingsOp.url);
      expect(payload).toMatchObject({
        minimapVisible: false,
        selectionControlsVisible: true,
      });
    });
  });



  describe('syncSaveHighlights bookmark budget', () => {
    it('skips bookmark sync when a single page payload exceeds bookmark item soft limit', async () => {
      const url = 'https://large-page.test';
      const hugeText = 'x'.repeat(60 * 1024);
      const highlights = [{ groupId: 'g1', updatedAt: Date.now(), text: hugeText, ranges: [] }];

      chrome.storage.local.get.mockResolvedValueOnce({ [`${url}_meta`]: {} });
      chrome.storage.local.set.mockResolvedValue(undefined);

      await syncSaveHighlights(url, highlights, 'Large', new Date().toISOString());

      const createdTitles = chrome.bookmarks.create.mock.calls.map(call => call[0].title);
      const updatedTitles = chrome.bookmarks.update.mock.calls.map(call => call[1].title);

      expect(createdTitles.some(title => /^hl_/.test(title))).toBe(false);
      expect(updatedTitles.some(title => /^hl_/.test(title))).toBe(false);
    });
  });



  describe('UTF-8 safe bookmark payload encoding', () => {
    it('saves multilingual settings without throwing when btoa/atob are strict Latin-1', async () => {
      const originalBtoa = globalThis.btoa;
      const originalAtob = globalThis.atob;

      try {
        globalThis.btoa = (str) => {
          for (let i = 0; i < str.length; i++) {
            if (str.charCodeAt(i) > 255) {
              throw new Error('InvalidCharacterError');
            }
          }
          return Buffer.from(str, 'binary').toString('base64');
        };
        globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');

        chrome.storage.local.get.mockResolvedValueOnce({
          customColors: [{ id: 'custom_ko', color: '#12AB34', nameKey: '커스텀😀' }],
          minimapVisible: true,
          selectionControlsVisible: false,
        });

        chrome.bookmarks.search.mockResolvedValue([{ id: 'root-folder', title: 'Text Highlighter Sync' }]);
        chrome.bookmarks.getChildren.mockResolvedValue([]);

        await expect(saveSettingsToSync()).resolves.toBeUndefined();

        const settingsOp = [
          ...chrome.bookmarks.create.mock.calls.map(call => call[0]),
          ...chrome.bookmarks.update.mock.calls.map(call => call[1]),
        ].find(op => op && op.title === 'settings');

        expect(settingsOp).toBeDefined();
        const payload = parseBookmarkPayload(settingsOp.url);
        expect(payload.customColors[0].nameKey).toBe('커스텀😀');
      } finally {
        globalThis.btoa = originalBtoa;
        globalThis.atob = originalAtob;
      }
    });
  });


  describe('UTF-8 safe highlight bookmark payload encoding', () => {
    it('saves multilingual highlight title/content without throwing under strict Latin-1 btoa/atob', async () => {
      const originalBtoa = globalThis.btoa;
      const originalAtob = globalThis.atob;

      try {
        globalThis.btoa = (str) => {
          for (let i = 0; i < str.length; i++) {
            if (str.charCodeAt(i) > 255) {
              throw new Error('InvalidCharacterError');
            }
          }
          return Buffer.from(str, 'binary').toString('base64');
        };
        globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');

        const url = 'https://utf8-highlight.test';
        const highlights = [{ groupId: 'g1', updatedAt: Date.now(), text: '하이라이트😀', ranges: [] }];

        chrome.storage.local.get.mockResolvedValueOnce({ [`${url}_meta`]: {} });
        chrome.storage.local.set.mockResolvedValue(undefined);
        chrome.bookmarks.search.mockResolvedValue([{ id: 'root-folder', title: 'Text Highlighter Sync' }]);
        chrome.bookmarks.getChildren.mockResolvedValue([]);

        await expect(syncSaveHighlights(url, highlights, '문서 제목😀', new Date().toISOString())).resolves.toBeUndefined();

        expect(chrome.storage.local.set).toHaveBeenCalled();
      } finally {
        globalThis.btoa = originalBtoa;
        globalThis.atob = originalAtob;
      }
    });
  });

  describe('bookmark API availability guard', () => {
    it('returns safely when bookmarks API is unavailable', async () => {
      const originalBookmarks = chrome.bookmarks;
      try {
        // Simulate missing permission/API surface
        // eslint-disable-next-line no-global-assign
        chrome.bookmarks = undefined;

        await expect(saveSettingsToSync()).resolves.toBeUndefined();
        await expect(syncSaveHighlights('https://no-bookmarks.test', [], '', '')).resolves.toBeUndefined();
        await expect(clearAllSyncedHighlights()).resolves.toBeUndefined();
      } finally {
        chrome.bookmarks = originalBookmarks;
      }
    });
  });

  describe('cleanupEmptyHighlightData', () => {
    it('removes page and metadata keys', async () => {
      await cleanupEmptyHighlightData('https://example.com');
      expect(chrome.storage.local.remove).toHaveBeenCalledWith([
        'https://example.com',
        'https://example.com_meta',
      ]);
    });
  });

  describe('clearAllSyncedHighlights', () => {
    it('marks tombstones and clears tracked pages', async () => {
      const now = 1700000000000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const metaPayload = {
        pages: [
          { syncKey: 'hl_1', url: 'https://a.com', size: 10 },
          { syncKey: 'hl_2', url: 'https://b.com', size: 20 },
        ],
        totalSize: 30,
        deletedUrls: {},
      };

      chrome.bookmarks.search.mockResolvedValue([{ id: 'root-folder', title: 'Text Highlighter Sync' }]);
      chrome.bookmarks.getChildren.mockImplementation(async () => ([
        { id: 'meta', title: 'sync_meta', url: `data:application/json;base64,${Buffer.from(JSON.stringify(metaPayload)).toString('base64')}` },
        { id: 'p1', title: 'hl_1', url: 'data:application/json;base64,e30=' },
        { id: 'p2', title: 'hl_2', url: 'data:application/json;base64,e30=' },
      ]));

      await clearAllSyncedHighlights();

      expect(chrome.bookmarks.remove).toHaveBeenCalledWith('p1');
      expect(chrome.bookmarks.remove).toHaveBeenCalledWith('p2');
      expect(chrome.bookmarks.update).toHaveBeenCalledWith('meta', expect.objectContaining({ url: expect.any(String) }));

      const updatedMetaDataUrl = chrome.bookmarks.update.mock.calls[0][1].url;
      const updatedMeta = parseBookmarkPayload(updatedMetaDataUrl);
      expect(updatedMeta.pages).toEqual([]);
      expect(updatedMeta.totalSize).toBe(0);
      expect(updatedMeta.deletedUrls['https://a.com']).toBe(now);
      expect(updatedMeta.deletedUrls['https://b.com']).toBe(now);

      Date.now.mockRestore();
    });
  });

  describe('initSyncListener', () => {
    it('registers bookmark listeners', () => {
      initSyncListener({});
      expect(chrome.bookmarks.onChanged.addListener).toHaveBeenCalledTimes(1);
      expect(chrome.bookmarks.onCreated.addListener).toHaveBeenCalledTimes(1);
      expect(chrome.bookmarks.onRemoved.addListener).toHaveBeenCalledTimes(1);
    });



    it('invokes onSettingsChanged when settings bookmark is newly created', async () => {
      const onSettingsChanged = jest.fn();
      initSyncListener({ onSettingsChanged });
      const listener = chrome.bookmarks.onCreated.addListener.mock.calls.at(-1)[0];

      const payload = { customColors: [], minimapVisible: true };
      const dataUrl = `data:application/json;base64,${Buffer.from(JSON.stringify(payload)).toString('base64')}`;

      await listener('new-id', { title: 'settings', url: dataUrl });
      expect(onSettingsChanged).toHaveBeenCalledWith(payload);
    });

    it('applies highlight data when highlight bookmark is newly created', async () => {
      initSyncListener({});
      const listener = chrome.bookmarks.onCreated.addListener.mock.calls.at(-1)[0];

      const incoming = {
        url: 'https://new-page.test',
        title: '새 페이지',
        lastUpdated: new Date().toISOString(),
        highlights: [{ groupId: 'g1', updatedAt: Date.now(), text: '새 하이라이트', ranges: [] }],
        deletedGroupIds: {},
      };

      chrome.storage.local.get.mockResolvedValueOnce({
        'https://new-page.test': [],
        'https://new-page.test_meta': {},
      });

      const dataUrl = `data:application/json;base64,${Buffer.from(JSON.stringify(incoming)).toString('base64')}`;
      await listener('new-hl', { title: 'hl_new', url: dataUrl });

      expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
        'https://new-page.test': expect.any(Array),
        'https://new-page.test_meta': expect.objectContaining({ title: '새 페이지' }),
      }));
    });

    it('invokes onSettingsChanged when settings bookmark changes', async () => {
      const onSettingsChanged = jest.fn();
      initSyncListener({ onSettingsChanged });
      const listener = chrome.bookmarks.onChanged.addListener.mock.calls.at(-1)[0];

      const payload = { customColors: [], minimapVisible: false };
      const dataUrl = `data:application/json;base64,${Buffer.from(JSON.stringify(payload)).toString('base64')}`;

      await listener('id1', { title: 'settings', url: dataUrl });
      expect(onSettingsChanged).toHaveBeenCalledWith(payload);
    });
  });
});
