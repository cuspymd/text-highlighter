import { browserAPI } from '../shared/browser-api.js';
import { debugLog } from '../shared/logger.js';
import { broadcastToTabsByUrl } from '../shared/tab-broadcast.js';
import { STORAGE_KEYS } from '../constants/storage-keys.js';
import {
  mergeHighlights,
  cleanupTombstones,
  normalizeSyncMeta,
  cleanupEmptyHighlightData,
  urlToSyncKey,
} from './sync-service.js';

// Re-export shared utilities so callers only need one import
export { cleanupEmptyHighlightData, cleanupTombstones, mergeHighlights };

const ROOT_FOLDER_NAME = 'Text Highlighter Sync';
const META_BOOKMARK_TITLE = 'meta';
const SETTINGS_BOOKMARK_TITLE = 'settings';
const BOOKMARK_HIGHLIGHT_PREFIX = 'hl_';

const SYNC_QUOTA_BYTES_PER_ITEM = 8192;
const SYNC_HIGHLIGHT_BUDGET = 90000;
const SYNC_REMOVAL_RECHECK_DELAY_MS = 500;
const SYNC_REMOVAL_MAX_RETRIES = 3;

let cachedRootFolderId = null;
const pendingRemovalResolutions = new Map();

// For testing: resets module-level cache
export function _clearRootFolderCache() {
  cachedRootFolderId = null;
}

// ===================================================================
// Pure helpers
// ===================================================================

/**
 * Compute SHA-256(url) and encode as base36 string with 'hl_' prefix.
 * More collision-resistant than the 32-bit hash in urlToSyncKey.
 */
export async function urlToBookmarkTitle(url) {
  const data = new TextEncoder().encode(url);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hexStr = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  const bigInt = BigInt('0x' + hexStr);
  return BOOKMARK_HIGHLIGHT_PREFIX + bigInt.toString(36);
}

export function encodePayload(data) {
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return 'data:application/json;base64,' + btoa(binary);
}

export function decodePayload(dataUrl) {
  try {
    const b64 = dataUrl.replace('data:application/json;base64,', '');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    debugLog('Failed to decode bookmark payload:', e.message);
    return null;
  }
}

function normalizeBookmarkMeta(rawMeta) {
  return normalizeSyncMeta(rawMeta);
}

// ===================================================================
// Bookmark access helpers
// ===================================================================

async function getOrCreateRootFolder() {
  if (cachedRootFolderId) {
    try {
      const results = await browserAPI.bookmarks.get(cachedRootFolderId);
      if (results && results.length > 0 && !results[0].url) return results[0];
    } catch (_e) {
      cachedRootFolderId = null;
    }
  }

  const results = await browserAPI.bookmarks.search({ title: ROOT_FOLDER_NAME });
  const folder = results.find(b => b.title === ROOT_FOLDER_NAME && !b.url);
  if (folder) {
    cachedRootFolderId = folder.id;
    return folder;
  }

  const newFolder = await browserAPI.bookmarks.create({ title: ROOT_FOLDER_NAME });
  cachedRootFolderId = newFolder.id;
  return newFolder;
}

async function getBookmarkByTitle(folderId, title) {
  try {
    const children = await browserAPI.bookmarks.getChildren(folderId);
    return children.find(b => b.title === title) || null;
  } catch (_e) {
    return null;
  }
}

async function upsertBookmark(folderId, title, payload) {
  const dataUrl = encodePayload(payload);
  const existing = await getBookmarkByTitle(folderId, title);
  if (existing) {
    return await browserAPI.bookmarks.update(existing.id, { url: dataUrl });
  }
  return await browserAPI.bookmarks.create({ parentId: folderId, title, url: dataUrl });
}

async function getBookmarkMeta(folderId) {
  try {
    const bookmark = await getBookmarkByTitle(folderId, META_BOOKMARK_TITLE);
    if (!bookmark) return normalizeBookmarkMeta(null);
    const data = decodePayload(bookmark.url);
    return normalizeBookmarkMeta(data);
  } catch (_e) {
    return normalizeBookmarkMeta(null);
  }
}

async function saveBookmarkMeta(folderId, meta) {
  await upsertBookmark(folderId, META_BOOKMARK_TITLE, meta);
}

async function getAllHighlightBookmarks(folderId) {
  try {
    const children = await browserAPI.bookmarks.getChildren(folderId);
    return children.filter(b => b.title && b.title.startsWith(BOOKMARK_HIGHLIGHT_PREFIX) && b.url);
  } catch (_e) {
    return [];
  }
}

// ===================================================================
// Settings
// ===================================================================

export async function getSettingsFromBookmarks() {
  try {
    const folder = await getOrCreateRootFolder();
    const bookmark = await getBookmarkByTitle(folder.id, SETTINGS_BOOKMARK_TITLE);
    if (!bookmark) return null;
    return decodePayload(bookmark.url);
  } catch (_e) {
    return null;
  }
}

export async function saveSettingsToBookmarks() {
  const result = await browserAPI.storage.local.get([
    STORAGE_KEYS.CUSTOM_COLORS,
    STORAGE_KEYS.MINIMAP_VISIBLE,
    STORAGE_KEYS.SELECTION_CONTROLS_VISIBLE,
  ]);
  const settings = {
    customColors: result.customColors || [],
    minimapVisible: result.minimapVisible !== undefined ? result.minimapVisible : true,
    selectionControlsVisible: result.selectionControlsVisible !== undefined ? result.selectionControlsVisible : true,
  };
  try {
    const folder = await getOrCreateRootFolder();
    await upsertBookmark(folder.id, SETTINGS_BOOKMARK_TITLE, settings);
    debugLog('Settings saved to bookmarks:', settings);
  } catch (e) {
    debugLog('Failed to save settings to bookmarks:', e.message);
  }
}

// ===================================================================
// Highlights
// ===================================================================

export async function saveHighlightsToBookmarks(url, highlights, title, lastUpdated) {
  try {
    const folder = await getOrCreateRootFolder();
    const bookmarkTitle = await urlToBookmarkTitle(url);

    const localMetaResult = await browserAPI.storage.local.get(`${url}${STORAGE_KEYS.META_SUFFIX}`);
    const localMeta = localMetaResult[`${url}${STORAGE_KEYS.META_SUFFIX}`] || {};

    const remoteBookmark = await getBookmarkByTitle(folder.id, bookmarkTitle);
    const remoteData = remoteBookmark ? (decodePayload(remoteBookmark.url) || {}) : {};

    const merged = mergeHighlights(
      { highlights, deletedGroupIds: localMeta.deletedGroupIds || {} },
      { highlights: remoteData.highlights || [], deletedGroupIds: remoteData.deletedGroupIds || {} }
    );

    // Always update local storage
    const localSave = {};
    localSave[url] = merged.highlights;
    localSave[`${url}${STORAGE_KEYS.META_SUFFIX}`] = {
      ...localMeta,
      title,
      lastUpdated,
      deletedGroupIds: merged.deletedGroupIds,
    };
    await browserAPI.storage.local.set(localSave);

    const data = { url, title, lastUpdated, highlights: merged.highlights, deletedGroupIds: merged.deletedGroupIds };
    const dataStr = JSON.stringify(data);
    const dataSize = new TextEncoder().encode(dataStr).byteLength;

    if (dataSize > SYNC_QUOTA_BYTES_PER_ITEM) {
      debugLog('Highlight data exceeds 8KB limit, bookmark sync skipped for:', url, `(${dataSize}B)`);
      return;
    }

    const meta = await getBookmarkMeta(folder.id);
    cleanupTombstones(meta.deletedUrls);
    if (meta.deletedUrls && meta.deletedUrls[url]) {
      delete meta.deletedUrls[url];
    }

    let totalSize = meta.totalSize || 0;

    // Evict oldest pages if budget exceeded
    while (totalSize + dataSize > SYNC_HIGHLIGHT_BUDGET && meta.pages.length > 0) {
      meta.pages.sort((a, b) => (a.lastUpdated || '').localeCompare(b.lastUpdated || ''));
      const oldest = meta.pages.shift();
      try {
        const oldBookmark = await getBookmarkByTitle(folder.id, oldest.bookmarkTitle);
        if (oldBookmark) await browserAPI.bookmarks.remove(oldBookmark.id);
        totalSize -= (oldest.size || 0);
        debugLog('Evicted oldest bookmark page:', oldest.bookmarkTitle, oldest.url);
      } catch (e) {
        debugLog('Error evicting bookmark page:', e.message);
      }
    }

    await upsertBookmark(folder.id, bookmarkTitle, data);

    const existingIdx = meta.pages.findIndex(p => p.bookmarkTitle === bookmarkTitle);
    const pageEntry = { bookmarkTitle, url, lastUpdated, size: dataSize };
    if (existingIdx >= 0) {
      totalSize -= (meta.pages[existingIdx].size || 0);
      meta.pages[existingIdx] = pageEntry;
    } else {
      meta.pages.push(pageEntry);
    }
    meta.totalSize = totalSize + dataSize;

    await saveBookmarkMeta(folder.id, meta);
    debugLog('Highlights saved to bookmarks for:', url, `(${dataSize}B, total: ${meta.totalSize}B)`);
  } catch (e) {
    debugLog('Failed to save highlights to bookmarks:', e.message);
  }
}

export async function removeHighlightsFromBookmarks(url) {
  try {
    const folder = await getOrCreateRootFolder();
    const bookmarkTitle = await urlToBookmarkTitle(url);

    const meta = await getBookmarkMeta(folder.id);
    const idx = meta.pages.findIndex(p => p.bookmarkTitle === bookmarkTitle);

    if (!meta.deletedUrls) meta.deletedUrls = {};
    meta.deletedUrls[url] = Date.now();
    cleanupTombstones(meta.deletedUrls);

    if (idx >= 0) {
      meta.totalSize = (meta.totalSize || 0) - (meta.pages[idx].size || 0);
      meta.pages.splice(idx, 1);
    }

    await saveBookmarkMeta(folder.id, meta);

    const pageBookmark = await getBookmarkByTitle(folder.id, bookmarkTitle);
    if (pageBookmark) await browserAPI.bookmarks.remove(pageBookmark.id);

    debugLog('Removed highlights from bookmarks and added tombstone for:', url);
  } catch (e) {
    debugLog('Failed to remove highlights from bookmarks:', e.message);
  }
}

export async function clearAllBookmarkHighlights() {
  try {
    const folder = await getOrCreateRootFolder();
    const meta = await getBookmarkMeta(folder.id);

    const now = Date.now();
    for (const page of meta.pages) {
      if (page.url) meta.deletedUrls[page.url] = now;
    }

    // Write tombstones before removing bookmarks so the onRemoved listener
    // can identify these as user-initiated deletions
    await saveBookmarkMeta(folder.id, meta);

    for (const page of meta.pages) {
      try {
        const pageBookmark = await getBookmarkByTitle(folder.id, page.bookmarkTitle);
        if (pageBookmark) await browserAPI.bookmarks.remove(pageBookmark.id);
      } catch (e) {
        debugLog('Error removing page bookmark during clearAll:', e.message);
      }
    }

    meta.pages = [];
    meta.totalSize = 0;
    await saveBookmarkMeta(folder.id, meta);
    debugLog('Cleared all bookmark highlights');
  } catch (e) {
    debugLog('Failed to clear all bookmark highlights:', e.message);
  }
}

// ===================================================================
// Migration
// ===================================================================

/**
 * Initial migration: merge local storage + old storage.sync + existing bookmark data,
 * then save everything to bookmarks and local storage.
 * Satisfies requirements S-9 and M-1.
 */
export async function migrateLocalToBookmarks() {
  const flagResult = await browserAPI.storage.local.get(STORAGE_KEYS.BOOKMARK_MIGRATION_DONE);
  if (flagResult[STORAGE_KEYS.BOOKMARK_MIGRATION_DONE]) return;

  debugLog('Starting bookmark sync migration...');
  try {
    const folder = await getOrCreateRootFolder();

    // --- Settings ---
    // Prefer bookmark settings; fall back to old storage.sync settings
    let remoteSettings = await getSettingsFromBookmarks();
    if (!remoteSettings) {
      try {
        const syncResult = await browserAPI.storage.sync.get('settings');
        remoteSettings = syncResult.settings || null;
      } catch (_e) {
        debugLog('Could not read settings from storage.sync (expected on Firefox Android)');
      }
    }

    if (remoteSettings) {
      const localResult = await browserAPI.storage.local.get([
        STORAGE_KEYS.CUSTOM_COLORS,
        STORAGE_KEYS.MINIMAP_VISIBLE,
        STORAGE_KEYS.SELECTION_CONTROLS_VISIBLE,
      ]);

      const mergedSettings = {
        customColors: [...(localResult.customColors || [])],
        minimapVisible: remoteSettings.minimapVisible !== undefined
          ? remoteSettings.minimapVisible
          : (localResult.minimapVisible !== undefined ? localResult.minimapVisible : true),
        selectionControlsVisible: remoteSettings.selectionControlsVisible !== undefined
          ? remoteSettings.selectionControlsVisible
          : (localResult.selectionControlsVisible !== undefined ? localResult.selectionControlsVisible : true),
      };

      if (remoteSettings.customColors) {
        remoteSettings.customColors.forEach(sc => {
          if (!mergedSettings.customColors.some(lc => lc.color.toLowerCase() === sc.color.toLowerCase())) {
            mergedSettings.customColors.push(sc);
          }
        });
      }

      await browserAPI.storage.local.set(mergedSettings);
    }
    await saveSettingsToBookmarks();

    // --- Highlights ---
    // Gather remote data from bookmarks
    const bookmarkHighlights = await getAllHighlightBookmarks(folder.id);
    const bookmarkDataByUrl = {};
    for (const bm of bookmarkHighlights) {
      const data = decodePayload(bm.url);
      if (data && data.url) bookmarkDataByUrl[data.url] = data;
    }

    // Gather remote meta: prefer bookmark meta, merge in old sync meta tombstones
    const bookmarkMeta = await getBookmarkMeta(folder.id);
    let oldSyncMeta = { pages: [], deletedUrls: {} };
    let oldSyncData = {};
    try {
      const syncMetaResult = await browserAPI.storage.sync.get('sync_meta');
      oldSyncMeta = normalizeSyncMeta(syncMetaResult.sync_meta);
      if (oldSyncMeta.pages.length > 0) {
        const syncKeys = oldSyncMeta.pages.map(p => p.syncKey).filter(Boolean);
        if (syncKeys.length > 0) {
          oldSyncData = await browserAPI.storage.sync.get(syncKeys);
        }
      }
    } catch (_e) {
      debugLog('Could not read from storage.sync (expected on Firefox Android)');
    }

    // Merge tombstones from both sources
    const mergedDeletedUrls = {
      ...(bookmarkMeta.deletedUrls || {}),
      ...(oldSyncMeta.deletedUrls || {}),
    };

    const allLocal = await browserAPI.storage.local.get(null);
    const localUrls = Object.keys(allLocal).filter(k =>
      ![
        STORAGE_KEYS.CUSTOM_COLORS,
        STORAGE_KEYS.BOOKMARK_MIGRATION_DONE,
        STORAGE_KEYS.SYNC_MIGRATION_DONE,
        STORAGE_KEYS.MINIMAP_VISIBLE,
        STORAGE_KEYS.SELECTION_CONTROLS_VISIBLE,
        'settings',
      ].includes(k) &&
      !k.endsWith(STORAGE_KEYS.META_SUFFIX) &&
      Array.isArray(allLocal[k])
    );

    const allUrls = new Set([
      ...localUrls,
      ...Object.keys(bookmarkDataByUrl),
      ...oldSyncMeta.pages.map(p => p.url).filter(Boolean),
    ]);

    for (const url of allUrls) {
      // Skip URLs that were explicitly user-deleted and have no local data
      if (mergedDeletedUrls[url] && !(allLocal[url] && allLocal[url].length > 0)) continue;

      const localHighlights = allLocal[url] || [];
      const localMeta = allLocal[`${url}${STORAGE_KEYS.META_SUFFIX}`] || {};

      // Prefer bookmark data; fall back to old sync data
      let remotePageData = bookmarkDataByUrl[url] || {};
      if (!remotePageData.highlights) {
        const syncKey = urlToSyncKey(url);
        remotePageData = oldSyncData[syncKey] || {};
      }

      const merged = mergeHighlights(
        { highlights: localHighlights, deletedGroupIds: localMeta.deletedGroupIds || {} },
        { highlights: remotePageData.highlights || [], deletedGroupIds: remotePageData.deletedGroupIds || {} }
      );

      const metaToSave = {
        title: localMeta.title || remotePageData.title || '',
        lastUpdated: localMeta.lastUpdated || remotePageData.lastUpdated || '',
        deletedGroupIds: merged.deletedGroupIds,
      };

      await browserAPI.storage.local.set({
        [url]: merged.highlights,
        [`${url}${STORAGE_KEYS.META_SUFFIX}`]: metaToSave,
      });

      await saveHighlightsToBookmarks(url, merged.highlights, metaToSave.title, metaToSave.lastUpdated);
    }

    await browserAPI.storage.local.set({ [STORAGE_KEYS.BOOKMARK_MIGRATION_DONE]: true });
    debugLog('Bookmark sync migration completed.');
  } catch (e) {
    debugLog('Bookmark sync migration error:', e.message);
  }
}

// ===================================================================
// Sync listener
// ===================================================================

async function applyUserDeletion(url) {
  await cleanupEmptyHighlightData(url);
  await broadcastToTabsByUrl(url, { action: 'refreshHighlights', highlights: [] });
}

/**
 * Register bookmark change/removal listeners for cross-device sync.
 * @param {object} callbacks
 * @param {function} callbacks.onSettingsChanged - Called with new settings when bookmark settings change.
 */
export function initBookmarkSyncListener({ onSettingsChanged } = {}) {
  let listenerRootFolderId = null;

  async function ensureListenerRootFolderId() {
    if (listenerRootFolderId) return listenerRootFolderId;
    const folder = await getOrCreateRootFolder();
    listenerRootFolderId = folder.id;
    return listenerRootFolderId;
  }

  const scheduleRemovalResolution = (url, retryCount = 0) => {
    if (!url) return;

    const existing = pendingRemovalResolutions.get(url);
    if (existing) clearTimeout(existing.timeoutId);

    const timeoutId = setTimeout(async () => {
      try {
        const folderId = await ensureListenerRootFolderId();
        const meta = await getBookmarkMeta(folderId);

        if (meta.deletedUrls && meta.deletedUrls[url]) {
          debugLog('Confirmed user-initiated deletion for:', url);
          await applyUserDeletion(url);
          pendingRemovalResolutions.delete(url);
          return;
        }

        if (retryCount < SYNC_REMOVAL_MAX_RETRIES) {
          scheduleRemovalResolution(url, retryCount + 1);
          return;
        }

        debugLog('Bookmark removal treated as eviction after retries. Keeping local data for:', url);
      } catch (e) {
        debugLog('Error resolving bookmark removal for:', url, e.message);
      } finally {
        const pending = pendingRemovalResolutions.get(url);
        if (pending && pending.timeoutId === timeoutId) {
          pendingRemovalResolutions.delete(url);
        }
      }
    }, SYNC_REMOVAL_RECHECK_DELAY_MS);

    pendingRemovalResolutions.set(url, { timeoutId });
  };

  browserAPI.bookmarks.onChanged.addListener(async (id, changeInfo) => {
    try {
      const folderId = await ensureListenerRootFolderId();
      const bookmarks = await browserAPI.bookmarks.get(id);
      if (!bookmarks || !bookmarks.length) return;
      const bm = bookmarks[0];
      if (bm.parentId !== folderId) return;

      const title = bm.title;
      const dataUrl = changeInfo.url || bm.url;
      if (!dataUrl) return;

      if (title === SETTINGS_BOOKMARK_TITLE) {
        const settings = decodePayload(dataUrl);
        if (settings && onSettingsChanged) {
          await onSettingsChanged(settings);
        }
      } else if (title && title.startsWith(BOOKMARK_HIGHLIGHT_PREFIX)) {
        const remoteData = decodePayload(dataUrl);
        if (!remoteData || !remoteData.url) return;

        const pageUrl = remoteData.url;
        const localResult = await browserAPI.storage.local.get([pageUrl, `${pageUrl}${STORAGE_KEYS.META_SUFFIX}`]);
        const localHighlights = localResult[pageUrl] || [];
        const localMeta = localResult[`${pageUrl}${STORAGE_KEYS.META_SUFFIX}`] || {};

        const merged = mergeHighlights(
          { highlights: localHighlights, deletedGroupIds: localMeta.deletedGroupIds || {} },
          { highlights: remoteData.highlights || [], deletedGroupIds: remoteData.deletedGroupIds || {} }
        );

        const saveData = {};
        saveData[pageUrl] = merged.highlights;
        saveData[`${pageUrl}${STORAGE_KEYS.META_SUFFIX}`] = {
          ...localMeta,
          title: remoteData.title || localMeta.title || '',
          lastUpdated: remoteData.lastUpdated || localMeta.lastUpdated || '',
          deletedGroupIds: merged.deletedGroupIds,
        };
        await browserAPI.storage.local.set(saveData);
        debugLog('Bookmark-synced highlights merged and applied for:', pageUrl);

        await broadcastToTabsByUrl(pageUrl, { action: 'refreshHighlights', highlights: merged.highlights });
      }
    } catch (e) {
      debugLog('Error processing bookmark change:', e.message);
    }
  });

  browserAPI.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
    try {
      const folderId = await ensureListenerRootFolderId();
      const node = removeInfo.node;
      if (!node || node.parentId !== folderId) return;
      if (!node.title || !node.title.startsWith(BOOKMARK_HIGHLIGHT_PREFIX)) return;

      const data = node.url ? decodePayload(node.url) : null;
      if (!data || !data.url) return;

      scheduleRemovalResolution(data.url);
    } catch (e) {
      debugLog('Error processing bookmark removal:', e.message);
    }
  });
}
