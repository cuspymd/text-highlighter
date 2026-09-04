import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import { STORAGE_KEYS, CLOUD_SYNC_KEYS } from '../constants/storage-keys.js';

const PAGE = 'https://example.com/article';
const OTHER_PAGE = 'https://example.com/other';

describe('message-router', () => {
  let send;
  let local;
  let sync;

  beforeEach(async () => {
    jest.clearAllMocks();
    local = installStore(chrome.storage.local);
    sync = installStore(chrome.storage.sync);
    chrome.tabs.query.mockResolvedValue([]);
    global.fetch = jest.fn();

    send = await loadRouter();
  });

  /**
   * Register a router built from a fresh module graph.
   *
   * settings-service caches the custom colours it has loaded in module state,
   * and the sync services keep their own. Without the reset one test's colours
   * are still there for the next, and the order tests run in starts to matter.
   * `shared/browser-api.js` reads the `chrome` global, which the reset does not
   * replace, so the fresh graph still talks to the mock this file asserts on.
   */
  async function loadRouter() {
    jest.resetModules();
    const { registerMessageRouter } = await import('../background/message-router.js');
    registerMessageRouter();

    const listener = chrome.runtime.onMessage.addListener.mock.calls.at(-1)[0];
    return (message, sender = {}) => new Promise(resolve => {
      listener(message, sender, resolve);
    });
  }

  /**
   * Back a storage area with a real object, so handlers that read, change and
   * write again see their own writes. The default mock answers everything with
   * `{}`, which makes every such handler look like it is working on an empty
   * profile.
   */
  function installStore(area, initial = {}) {
    const store = { ...initial };

    area.get.mockImplementation(async keys => {
      if (keys === null || keys === undefined) return { ...store };
      const wanted = Array.isArray(keys) ? keys : [keys];
      const out = {};
      wanted.forEach(key => { if (key in store) out[key] = store[key]; });
      return out;
    });
    area.set.mockImplementation(async items => { Object.assign(store, items); });
    area.remove.mockImplementation(async keys => {
      (Array.isArray(keys) ? keys : [keys]).forEach(key => { delete store[key]; });
    });

    return store;
  }

  function openTabs(...urls) {
    chrome.tabs.query.mockResolvedValue(urls.map((url, index) => ({ id: index + 1, url })));
  }

  function tabMessages(action) {
    return chrome.tabs.sendMessage.mock.calls
      .map(([tabId, message]) => ({ tabId, message }))
      .filter(entry => entry.message.action === action);
  }

  function meta(url) {
    return local[`${url}${STORAGE_KEYS.META_SUFFIX}`];
  }

  function customColorIds(colors) {
    return colors.filter(color => color.id.startsWith('custom_')).map(color => color.id);
  }

  // ===================================================================
  // Registration and routing
  // ===================================================================

  describe('registration', () => {
    it('registers exactly one runtime.onMessage listener', () => {
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    });

    it('returns a failure response for an unknown action', async () => {
      const result = await send({ action: 'doesNotExist' });

      expect(result).toEqual({ success: false, error: expect.stringContaining('doesNotExist') });
    });

    it('turns a handler that throws into a failure response rather than a dropped message', async () => {
      chrome.storage.local.get.mockRejectedValueOnce(new Error('storage is gone'));

      const result = await send({ action: 'getHighlights', url: PAGE });

      expect(result).toEqual({ success: false, error: 'storage is gone' });
    });
  });

  // ===================================================================
  // Read-only handlers
  // ===================================================================

  describe('getDebugMode', () => {
    it('returns a debugMode boolean', async () => {
      const result = await send({ action: 'getDebugMode' });

      expect(typeof result.debugMode).toBe('boolean');
    });
  });

  describe('getPlatformInfo', () => {
    it('returns platform and isMobile fields', async () => {
      const result = await send({ action: 'getPlatformInfo' });

      expect(result).toHaveProperty('platform');
      expect(result).toHaveProperty('isMobile');
    });
  });

  describe('getColors', () => {
    it('includes custom colors loaded from storage before returning', async () => {
      sync.settings = { customColors: [{ id: 'custom_123', colorNumber: 1, color: '#123456' }] };

      const result = await send({ action: 'getColors' });

      expect(result.colors.length).toBeGreaterThanOrEqual(5);
      expect(result.colors.some(color => color.id === 'custom_123' && color.color === '#123456')).toBe(true);
    });

    it('returns the built-in colors when nothing custom is stored', async () => {
      const result = await send({ action: 'getColors' });

      expect(customColorIds(result.colors)).toEqual([]);
      expect(result.colors.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('getHighlights', () => {
    it('returns stored highlights for a url', async () => {
      local[PAGE] = [{ groupId: 'g1', color: '#FFFF00' }];

      const result = await send({ action: 'getHighlights', url: PAGE });

      expect(result.highlights).toHaveLength(1);
      expect(result.highlights[0].groupId).toBe('g1');
    });

    it('returns an empty array when nothing is stored', async () => {
      const result = await send({ action: 'getHighlights', url: 'https://empty.test' });

      expect(result.highlights).toEqual([]);
    });
  });

  // ===================================================================
  // Settings
  // ===================================================================

  describe('saveSettings', () => {
    it('stores the setting and tells the open tabs about it', async () => {
      openTabs(PAGE, OTHER_PAGE);

      const result = await send({ action: 'saveSettings', minimapVisible: false });

      expect(result.success).toBe(true);
      expect(local.minimapVisible).toBe(false);
      expect(tabMessages('setMinimapVisibility').map(entry => entry.tabId)).toEqual([1, 2]);
    });

    it('says nothing to the tabs when the value did not actually change', async () => {
      openTabs(PAGE);
      local.minimapVisible = true;

      await send({ action: 'saveSettings', minimapVisible: true });

      expect(tabMessages('setMinimapVisibility')).toHaveLength(0);
    });

    it('carries both settings independently', async () => {
      openTabs(PAGE);

      await send({ action: 'saveSettings', minimapVisible: false, selectionControlsVisible: false });

      expect(tabMessages('setMinimapVisibility')).toHaveLength(1);
      expect(tabMessages('setSelectionControlsVisibility')).toHaveLength(1);
    });

    // The mirror to sync is deliberately not awaited: the local write has already
    // happened, so a sync that fails must not turn into a failed save.
    it('still reports success when the settings could not be mirrored to sync', async () => {
      const store = chrome.storage.local.set.getMockImplementation();
      chrome.storage.local.set.mockImplementation(async items => {
        if (CLOUD_SYNC_KEYS.SETTINGS_UPDATED_AT in items) throw new Error('sync quota exceeded');
        return store(items);
      });

      const result = await send({ action: 'saveSettings', minimapVisible: false });
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(result).toEqual({ success: true });
      expect(local.minimapVisible).toBe(false);
    });

    it('succeeds without writing anything when the message carries no setting', async () => {
      const result = await send({ action: 'saveSettings' });

      expect(result).toEqual({ success: true });
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
  });

  // ===================================================================
  // Custom colors
  // ===================================================================

  describe('addColor', () => {
    it('refuses a message with no color', async () => {
      const result = await send({ action: 'addColor' });

      expect(result).toEqual({ success: false, error: 'No color value provided' });
    });

    it('adds the color, rebuilds the menus and tells the tabs', async () => {
      openTabs(PAGE);

      const result = await send({ action: 'addColor', color: '#abcdef' });

      expect(result.success).toBe(true);
      expect(result.exists).toBe(false);
      expect(result.colors.some(color => color.color === '#abcdef')).toBe(true);
      expect(chrome.contextMenus.create).toHaveBeenCalled();
      expect(tabMessages('colorsUpdated')).toHaveLength(1);
    });

    it('reports a duplicate without touching menus or tabs', async () => {
      openTabs(PAGE);
      const { colors } = await send({ action: 'addColor', color: '#abcdef' });
      jest.clearAllMocks();
      openTabs(PAGE);

      const result = await send({ action: 'addColor', color: colors[0].color });

      expect(result.exists).toBe(true);
      expect(tabMessages('colorsUpdated')).toHaveLength(0);
    });
  });

  describe('updateCustomColor', () => {
    it('refuses a message missing the id or the color', async () => {
      expect(await send({ action: 'updateCustomColor', color: '#abcdef' }))
        .toEqual({ success: false, error: 'Missing id or color' });
      expect(await send({ action: 'updateCustomColor', id: 'custom_1' }))
        .toEqual({ success: false, error: 'Missing id or color' });
    });

    it('reports a color id that is not there', async () => {
      const result = await send({ action: 'updateCustomColor', id: 'custom_nope', color: '#abcdef' });

      expect(result).toEqual({ success: false, error: 'Color not found' });
    });

    it('changes the color and tells the tabs', async () => {
      const added = await send({ action: 'addColor', color: '#abcdef' });
      const id = customColorIds(added.colors)[0];
      jest.clearAllMocks();
      openTabs(PAGE);

      const result = await send({ action: 'updateCustomColor', id, color: '#fedcba' });

      expect(result.success).toBe(true);
      expect(result.colors.some(color => color.color === '#fedcba')).toBe(true);
      expect(tabMessages('colorsUpdated')).toHaveLength(1);
    });
  });

  describe('updateCustomColorName', () => {
    it('refuses a message missing the id or the name', async () => {
      expect(await send({ action: 'updateCustomColorName', name: 'Coral' }))
        .toEqual({ success: false, error: 'Missing id or name' });
      expect(await send({ action: 'updateCustomColorName', id: 'custom_1' }))
        .toEqual({ success: false, error: 'Missing id or name' });
    });

    it('reports a color id that is not there', async () => {
      const result = await send({ action: 'updateCustomColorName', id: 'custom_nope', name: 'Coral' });

      expect(result).toEqual({ success: false, error: 'Color not found' });
    });

    it('renames the color and tells the tabs', async () => {
      const added = await send({ action: 'addColor', color: '#abcdef' });
      const id = customColorIds(added.colors)[0];
      jest.clearAllMocks();
      openTabs(PAGE);

      const result = await send({ action: 'updateCustomColorName', id, name: 'Coral' });

      expect(result.success).toBe(true);
      expect(result.colors.some(color => color.customName === 'Coral')).toBe(true);
      expect(tabMessages('colorsUpdated')).toHaveLength(1);
    });
  });

  describe('removeCustomColor', () => {
    it('refuses a message with no id', async () => {
      expect(await send({ action: 'removeCustomColor' }))
        .toEqual({ success: false, error: 'Missing id' });
    });

    it('reports a color id that is not there', async () => {
      expect(await send({ action: 'removeCustomColor', id: 'custom_nope' }))
        .toEqual({ success: false, error: 'Color not found' });
    });

    it('removes the color and tells the tabs', async () => {
      const added = await send({ action: 'addColor', color: '#abcdef' });
      const id = customColorIds(added.colors)[0];
      jest.clearAllMocks();
      openTabs(PAGE);

      const result = await send({ action: 'removeCustomColor', id });

      expect(customColorIds(result.colors)).toEqual([]);
      expect(tabMessages('colorsUpdated')).toHaveLength(1);
    });
  });

  describe('clearCustomColors', () => {
    it('says so when there was nothing to clear, and leaves the tabs alone', async () => {
      openTabs(PAGE);

      const result = await send({ action: 'clearCustomColors' });

      expect(result).toMatchObject({ success: true, noCustomColors: true });
      expect(customColorIds(result.colors)).toEqual([]);
      expect(tabMessages('colorsUpdated')).toHaveLength(0);
    });

    it('clears the custom colors and tells the tabs', async () => {
      await send({ action: 'addColor', color: '#abcdef' });
      jest.clearAllMocks();
      openTabs(PAGE);

      const result = await send({ action: 'clearCustomColors' });

      expect(result.success).toBe(true);
      expect(customColorIds(result.colors)).toEqual([]);
      expect(tabMessages('colorsUpdated')).toHaveLength(1);
      expect(customColorIds((await send({ action: 'getColors' })).colors)).toEqual([]);
    });
  });

  // ===================================================================
  // Shortcuts
  // ===================================================================

  describe('shortcut colour map', () => {
    it('returns the stored map', async () => {
      local[STORAGE_KEYS.SHORTCUT_COLOR_MAP] = { command_slot_1: 'yellow' };

      const result = await send({ action: 'getShortcutColorMap' });

      expect(result.success).toBe(true);
      expect(result.shortcutColorMap).toEqual({ command_slot_1: 'yellow' });
    });

    it('refuses a save with no map', async () => {
      expect(await send({ action: 'saveShortcutColorMap' }))
        .toEqual({ success: false, error: 'Missing shortcutColorMap' });
    });

    it('saves the map and rebuilds the menus', async () => {
      const result = await send({
        action: 'saveShortcutColorMap',
        shortcutColorMap: { command_slot_2: 'green' },
      });

      expect(result).toEqual({ success: true });
      expect(local[STORAGE_KEYS.SHORTCUT_COLOR_MAP]).toEqual({ command_slot_2: 'green' });
      expect(chrome.contextMenus.create).toHaveBeenCalled();
    });
  });

  // ===================================================================
  // Saving and deleting highlights
  // ===================================================================

  describe('saveHighlights', () => {
    it('stores the highlights and stamps the page metadata from the sending tab', async () => {
      const highlights = [{ groupId: 'g1', color: '#ffff00', text: 'hello' }];

      const result = await send(
        { action: 'saveHighlights', url: PAGE, highlights },
        { tab: { id: 4, title: 'Article title' } }
      );

      expect(result).toEqual({ success: true });
      expect(local[PAGE]).toEqual(highlights);
      expect(meta(PAGE).title).toBe('Article title');
      expect(meta(PAGE).lastUpdated).toEqual(expect.any(String));
    });

    it('keeps the existing title when the message did not come from a tab', async () => {
      local[`${PAGE}${STORAGE_KEYS.META_SUFFIX}`] = { title: 'Earlier title' };

      await send({ action: 'saveHighlights', url: PAGE, highlights: [{ groupId: 'g1', color: '#ffff00' }] });

      expect(meta(PAGE).title).toBe('Earlier title');
    });

    it('clears the page instead of storing an empty list', async () => {
      local[PAGE] = [{ groupId: 'g1', color: '#ffff00' }];
      local[`${PAGE}${STORAGE_KEYS.META_SUFFIX}`] = { title: 'Article title' };

      const result = await send({ action: 'saveHighlights', url: PAGE, highlights: [] });

      expect(result).toEqual({ success: true });
      expect(local[PAGE]).toBeUndefined();
      expect(meta(PAGE)).toBeUndefined();
    });
  });

  describe('deleteHighlight', () => {
    beforeEach(() => {
      local[PAGE] = [
        { groupId: 'g1', color: '#ffff00', text: 'first' },
        { groupId: 'g2', color: '#80cbc4', text: 'second' },
      ];
      local[`${PAGE}${STORAGE_KEYS.META_SUFFIX}`] = { title: 'Article title' };
    });

    it('removes one group and keeps the rest', async () => {
      const result = await send({ action: 'deleteHighlight', url: PAGE, groupId: 'g1' });

      expect(result.highlights.map(group => group.groupId)).toEqual(['g2']);
      expect(local[PAGE].map(group => group.groupId)).toEqual(['g2']);
    });

    it('records a tombstone so a later sync does not bring the group back', async () => {
      await send({ action: 'deleteHighlight', url: PAGE, groupId: 'g1' });

      expect(meta(PAGE).deletedGroupIds).toHaveProperty('g1');
    });

    it('clears the page once its last group goes', async () => {
      local[PAGE] = [{ groupId: 'g1', color: '#ffff00' }];

      const result = await send({ action: 'deleteHighlight', url: PAGE, groupId: 'g1' });

      expect(result.highlights).toEqual([]);
      expect(local[PAGE]).toBeUndefined();
    });

    it('says nothing to the tabs unless asked to', async () => {
      openTabs(PAGE);

      await send({ action: 'deleteHighlight', url: PAGE, groupId: 'g1' });

      expect(tabMessages('refreshHighlights')).toHaveLength(0);
    });

    it('sends the tabs what is left of the page', async () => {
      openTabs(PAGE);

      await send({ action: 'deleteHighlight', url: PAGE, groupId: 'g1', notifyRefresh: true });

      const refreshed = tabMessages('refreshHighlights');
      expect(refreshed).toHaveLength(1);
      expect(refreshed[0].message.highlights.map(group => group.groupId)).toEqual(['g2']);
    });

    it('sends the tabs an empty page when the last group goes', async () => {
      openTabs(PAGE);
      local[PAGE] = [{ groupId: 'g1', color: '#ffff00' }];

      await send({ action: 'deleteHighlight', url: PAGE, groupId: 'g1', notifyRefresh: true });

      expect(tabMessages('refreshHighlights')[0].message.highlights).toEqual([]);
    });

    it('does not send the refresh back to the tab that asked for the delete', async () => {
      openTabs(PAGE, PAGE);

      await send(
        { action: 'deleteHighlight', url: PAGE, groupId: 'g1', notifyRefresh: true },
        { tab: { id: 1, url: PAGE } }
      );

      expect(tabMessages('refreshHighlights').map(entry => entry.tabId)).toEqual([2]);
    });
  });

  describe('saveHighlights with deletedGroupIds', () => {
    // Recent enough to survive the tombstone cleanup a save runs.
    const earlierTombstone = Date.now() - 1000;

    beforeEach(() => {
      local[PAGE] = [
        { groupId: 'g1', color: '#ffff00', text: 'first' },
        { groupId: 'g2', color: '#80cbc4', text: 'second' },
      ];
      local[`${PAGE}${STORAGE_KEYS.META_SUFFIX}`] = {
        title: 'Article title',
        deletedGroupIds: { g0: earlierTombstone },
      };
    });

    it('records tombstones for the groups a merge replaced, alongside the new list', async () => {
      await send({
        action: 'saveHighlights',
        url: PAGE,
        highlights: [{ groupId: 'g3', color: '#ffff00', text: 'first second' }],
        deletedGroupIds: ['g1', 'g2'],
      });

      expect(local[PAGE].map(group => group.groupId)).toEqual(['g3']);
      expect(Object.keys(meta(PAGE).deletedGroupIds).sort()).toEqual(['g0', 'g1', 'g2']);
      expect(meta(PAGE).deletedGroupIds.g1).toBeGreaterThan(0);
    });

    it('writes the list and its tombstones in one storage write', async () => {
      await send({
        action: 'saveHighlights',
        url: PAGE,
        highlights: [{ groupId: 'g3', color: '#ffff00', text: 'first second' }],
        deletedGroupIds: ['g1', 'g2'],
      });

      // A save from another tab between two separate writes would read the
      // new list with the old metadata and write the tombstones away again, so
      // no write may carry the list without them. (The sync layer repeats the
      // pair afterwards, tombstones included.)
      const listWrites = chrome.storage.local.set.mock.calls
        .map(([items]) => items)
        .filter(items => PAGE in items);
      expect(listWrites.length).toBeGreaterThan(0);
      listWrites.forEach(items => {
        const written = items[`${PAGE}${STORAGE_KEYS.META_SUFFIX}`];
        expect(written && Object.keys(written.deletedGroupIds).sort()).toEqual(['g0', 'g1', 'g2']);
      });
    });

    it('keeps existing tombstones when a save names none', async () => {
      await send({
        action: 'saveHighlights',
        url: PAGE,
        highlights: [{ groupId: 'g1', color: '#ffff00', text: 'first' }],
      });

      expect(meta(PAGE).deletedGroupIds).toEqual({ g0: earlierTombstone });
    });
  });

  describe('clearAllHighlights', () => {
    it('drops the page and its metadata', async () => {
      local[PAGE] = [{ groupId: 'g1', color: '#ffff00' }];
      local[`${PAGE}${STORAGE_KEYS.META_SUFFIX}`] = { title: 'Article title' };

      const result = await send({ action: 'clearAllHighlights', url: PAGE });

      expect(result).toEqual({ success: true });
      expect(local[PAGE]).toBeUndefined();
      expect(meta(PAGE)).toBeUndefined();
    });

    it('refreshes the tabs on that url when asked to', async () => {
      openTabs(PAGE);
      local[PAGE] = [{ groupId: 'g1', color: '#ffff00' }];

      await send({ action: 'clearAllHighlights', url: PAGE, notifyRefresh: true });

      expect(tabMessages('refreshHighlights')[0].message.highlights).toEqual([]);
    });
  });

  // ===================================================================
  // The saved-pages list
  // ===================================================================

  describe('getAllHighlightedPages', () => {
    it('returns an empty list for an empty profile', async () => {
      const result = await send({ action: 'getAllHighlightedPages' });

      expect(result.success).toBe(true);
      expect(result.pages).toEqual([]);
    });

    it('describes each page from its highlights and metadata', async () => {
      local[PAGE] = [{ groupId: 'g1' }, { groupId: 'g2' }];
      local[`${PAGE}${STORAGE_KEYS.META_SUFFIX}`] = {
        title: 'Article title',
        lastUpdated: '2026-06-01T00:00:00.000Z',
      };

      const { pages } = await send({ action: 'getAllHighlightedPages' });

      expect(pages).toHaveLength(1);
      expect(pages[0]).toMatchObject({
        url: PAGE,
        title: 'Article title',
        highlightCount: 2,
        lastUpdated: '2026-06-01T00:00:00.000Z',
      });
    });

    it('lists the most recently updated page first', async () => {
      local[PAGE] = [{ groupId: 'g1' }];
      local[`${PAGE}${STORAGE_KEYS.META_SUFFIX}`] = { lastUpdated: '2026-01-01T00:00:00.000Z' };
      local[OTHER_PAGE] = [{ groupId: 'g2' }];
      local[`${OTHER_PAGE}${STORAGE_KEYS.META_SUFFIX}`] = { lastUpdated: '2026-06-01T00:00:00.000Z' };

      const { pages } = await send({ action: 'getAllHighlightedPages' });

      expect(pages.map(page => page.url)).toEqual([OTHER_PAGE, PAGE]);
    });

    it('does not mistake settings for a highlighted page', async () => {
      local[STORAGE_KEYS.CUSTOM_COLORS] = [{ id: 'custom_1', color: '#abcdef' }];
      local[STORAGE_KEYS.MINIMAP_VISIBLE] = true;
      local[PAGE] = [{ groupId: 'g1' }];

      const { pages } = await send({ action: 'getAllHighlightedPages' });

      expect(pages.map(page => page.url)).toEqual([PAGE]);
    });

    it('leaves out a page whose highlights are already gone', async () => {
      local[PAGE] = [];

      const { pages } = await send({ action: 'getAllHighlightedPages' });

      expect(pages).toEqual([]);
    });
  });

  describe('deleteAllHighlightedPages', () => {
    it('reports nothing deleted for an empty profile', async () => {
      const result = await send({ action: 'deleteAllHighlightedPages' });

      expect(result).toEqual({ success: true, deletedCount: 0 });
    });

    it('deletes every page and counts them, leaving the settings alone', async () => {
      local[PAGE] = [{ groupId: 'g1' }];
      local[`${PAGE}${STORAGE_KEYS.META_SUFFIX}`] = { title: 'Article title' };
      local[OTHER_PAGE] = [{ groupId: 'g2' }];
      local[STORAGE_KEYS.CUSTOM_COLORS] = [{ id: 'custom_1', color: '#abcdef' }];

      const result = await send({ action: 'deleteAllHighlightedPages' });

      expect(result).toEqual({ success: true, deletedCount: 2 });
      expect(local[PAGE]).toBeUndefined();
      expect(local[OTHER_PAGE]).toBeUndefined();
      expect(local[STORAGE_KEYS.CUSTOM_COLORS]).toBeDefined();
    });
  });

  // ===================================================================
  // Cloud sync
  // ===================================================================

  describe('cloud sync', () => {
    it('reports the stored status', async () => {
      local[CLOUD_SYNC_KEYS.ENABLED] = true;
      local[CLOUD_SYNC_KEYS.CODE] = 'ABCD-EFGH-IJKL';
      local[CLOUD_SYNC_KEYS.LAST_SYNCED_AT] = '2026-06-01T00:00:00.000Z';

      const result = await send({ action: 'getCloudSyncStatus' });

      expect(result).toMatchObject({
        success: true,
        enabled: true,
        code: 'ABCD-EFGH-IJKL',
        lastSyncedAt: '2026-06-01T00:00:00.000Z',
      });
    });

    it('reports the off state for a profile that never enabled it', async () => {
      const result = await send({ action: 'getCloudSyncStatus' });

      expect(result).toMatchObject({ success: true, enabled: false, code: null });
    });

    it('generates a code, turns sync on and pushes what this device has', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: false, status: 404 }) // GET: nothing stored yet
        .mockResolvedValueOnce({ ok: true, status: 204 }); // PUT: the first push

      const result = await send({ action: 'enableCloudSync' });

      expect(result.success).toBe(true);
      expect(result.code).toEqual(expect.any(String));
      expect(local[CLOUD_SYNC_KEYS.ENABLED]).toBe(true);
      expect(local[CLOUD_SYNC_KEYS.CODE]).toBe(result.code);
      expect(global.fetch.mock.calls[1][1].method).toBe('PUT');
    });

    it('refuses to pair without a code', async () => {
      const result = await send({ action: 'pairCloudSync' });

      expect(result).toEqual({ success: false, error: 'Missing sync code' });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('reports a code the server has nothing for, and stays off', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 404 });

      const result = await send({ action: 'pairCloudSync', code: 'ABCD-EFGH-IJKL' });

      expect(result.success).toBe(false);
      expect(local[CLOUD_SYNC_KEYS.ENABLED]).toBeUndefined();
    });

    it('turns sync off without forgetting the code', async () => {
      local[CLOUD_SYNC_KEYS.ENABLED] = true;
      local[CLOUD_SYNC_KEYS.CODE] = 'ABCD-EFGH-IJKL';

      const result = await send({ action: 'disableCloudSync' });

      expect(result).toEqual({ success: true });
      expect(local[CLOUD_SYNC_KEYS.ENABLED]).toBe(false);
      expect(local[CLOUD_SYNC_KEYS.CODE]).toBe('ABCD-EFGH-IJKL');
    });

    it('forgets the code on reset', async () => {
      local[CLOUD_SYNC_KEYS.ENABLED] = true;
      local[CLOUD_SYNC_KEYS.CODE] = 'ABCD-EFGH-IJKL';
      local[CLOUD_SYNC_KEYS.LAST_SYNCED_AT] = '2026-06-01T00:00:00.000Z';

      const result = await send({ action: 'resetCloudSyncCode' });

      expect(result).toEqual({ success: true });
      expect(local[CLOUD_SYNC_KEYS.ENABLED]).toBe(false);
      expect(local[CLOUD_SYNC_KEYS.CODE]).toBeNull();
      expect(local[CLOUD_SYNC_KEYS.LAST_SYNCED_AT]).toBeNull();
    });

    it('refuses a manual sync while sync is off, without reaching the network', async () => {
      const result = await send({ action: 'triggerCloudSync' });

      expect(result).toEqual({ success: false, error: 'Cloud sync is not enabled' });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
