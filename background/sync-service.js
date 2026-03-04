import { browserAPI } from '../shared/browser-api.js';
import { debugLog } from '../shared/logger.js';
import { broadcastToTabsByUrl } from '../shared/tab-broadcast.js';
import { STORAGE_KEYS, SYNC_KEYS } from '../constants/storage-keys.js';

// Bookmark storage has meaningfully larger limits than storage.sync.
// Keep a soft quota to avoid oversized payload churn and preserve predictable eviction.
const BOOKMARK_QUOTA_BYTES_PER_ITEM = 48 * 1024;
const BOOKMARK_HIGHLIGHT_BUDGET = 4 * 1024 * 1024;
const BOOKMARK_MAX_SYNC_PAGES = 5000;
const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SYNC_REMOVAL_RECHECK_DELAY_MS = 500;
const SYNC_REMOVAL_MAX_RETRIES = 3;

const ROOT_FOLDER_TITLE = 'Text Highlighter Sync';
const SETTINGS_BOOKMARK_TITLE = SYNC_KEYS.SETTINGS;
const META_BOOKMARK_TITLE = SYNC_KEYS.META;
const LEGACY_SYNC_MIGRATION_KEY = 'syncMigrationDone';

const pendingSyncRemovalResolutions = new Map();


function hasBookmarkSyncAPI() {
  return Boolean(
    browserAPI
    && browserAPI.bookmarks
    && browserAPI.bookmarks.search
    && browserAPI.bookmarks.create
    && browserAPI.bookmarks.update
    && browserAPI.bookmarks.remove
    && browserAPI.bookmarks.getChildren,
  );
}

function encodeUtf8(value) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value);
  }
  return Uint8Array.from(Buffer.from(value, 'utf-8'));
}

function decodeUtf8(bytes) {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(bytes).toString('utf-8');
}

function encodeBase64(value) {
  const bytes = encodeUtf8(value);

  if (typeof btoa === 'function') {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  return Buffer.from(bytes).toString('base64');
}

function decodeBase64(value) {
  if (typeof atob === 'function') {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    return decodeUtf8(bytes);
  }

  return Buffer.from(value, 'base64').toString('utf-8');
}

function encodePayloadToDataUrl(payload) {
  const serialized = JSON.stringify(payload);
  return `data:application/json;base64,${encodeBase64(serialized)}`;
}

function decodePayloadFromDataUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const marker = 'base64,';
  const markerIndex = url.indexOf(marker);
  if (markerIndex < 0) return null;

  try {
    const encoded = url.slice(markerIndex + marker.length);
    return JSON.parse(decodeBase64(encoded));
  } catch (e) {
    debugLog('Failed to decode bookmark payload:', e.message);
    return null;
  }
}

async function getSyncRootFolderId() {
  const results = await browserAPI.bookmarks.search({ title: ROOT_FOLDER_TITLE });
  const folder = results.find(node => !node.url && node.title === ROOT_FOLDER_TITLE);
  if (folder) return folder.id;

  const created = await browserAPI.bookmarks.create({ title: ROOT_FOLDER_TITLE });
  return created.id;
}

async function findBookmarkByTitle(title) {
  const rootId = await getSyncRootFolderId();
  const children = await browserAPI.bookmarks.getChildren(rootId);
  return children.find(node => node.title === title);
}

async function readBookmarkPayloadByTitle(title, fallbackValue) {
  try {
    const bookmark = await findBookmarkByTitle(title);
    if (!bookmark || !bookmark.url) return fallbackValue;
    const parsed = decodePayloadFromDataUrl(bookmark.url);
    return parsed === null ? fallbackValue : parsed;
  } catch (e) {
    debugLog('Failed reading bookmark payload:', title, e.message);
    return fallbackValue;
  }
}

async function upsertBookmarkPayload(title, payload) {
  const encodedUrl = encodePayloadToDataUrl(payload);
  const existing = await findBookmarkByTitle(title);
  if (existing) {
    const updated = await browserAPI.bookmarks.update(existing.id, { title, url: encodedUrl });
    return updated;
  }

  const parentId = await getSyncRootFolderId();
  return browserAPI.bookmarks.create({ parentId, title, url: encodedUrl });
}

async function removeBookmarkByTitle(title) {
  const bookmark = await findBookmarkByTitle(title);
  if (!bookmark) return;
  await browserAPI.bookmarks.remove(bookmark.id);
}

async function getBookmarkSyncMeta() {
  const meta = await readBookmarkPayloadByTitle(META_BOOKMARK_TITLE, null);
  return normalizeSyncMeta(meta);
}

async function saveBookmarkSyncMeta(meta) {
  await upsertBookmarkPayload(META_BOOKMARK_TITLE, normalizeSyncMeta(meta));
}

async function getRemotePageData(syncKey) {
  return readBookmarkPayloadByTitle(syncKey, {});
}

/**
 * Clean up old tombstones from a metadata object.
 */
export function cleanupTombstones(obj) {
  if (!obj) return;
  const now = Date.now();
  for (const key in obj) {
    if (now - obj[key] > TOMBSTONE_RETENTION_MS) {
      delete obj[key];
    }
  }
}

export function normalizeSyncMeta(rawMeta) {
  const meta = rawMeta || {};
  if (!Array.isArray(meta.pages)) meta.pages = [];
  if (typeof meta.totalSize !== 'number') meta.totalSize = 0;
  if (!meta.deletedUrls || typeof meta.deletedUrls !== 'object') meta.deletedUrls = {};
  cleanupTombstones(meta.deletedUrls);
  return meta;
}

export function urlToSyncKey(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const ch = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return `${SYNC_KEYS.HIGHLIGHT_PREFIX}${Math.abs(hash).toString(36)}`;
}

export function mergeHighlights(localData, remoteData) {
  const localHighlights = localData.highlights || [];
  const remoteHighlights = remoteData.highlights || [];
  const localDeleted = localData.deletedGroupIds || {};
  const remoteDeleted = remoteData.deletedGroupIds || {};

  const mergedDeleted = { ...localDeleted, ...remoteDeleted };
  cleanupTombstones(mergedDeleted);

  const allGroupsMap = new Map();
  [...localHighlights, ...remoteHighlights].forEach(group => {
    const existing = allGroupsMap.get(group.groupId);
    const groupTime = group.updatedAt || 0;
    const existingTime = existing ? (existing.updatedAt || 0) : -1;
    if (!existing || groupTime > existingTime) {
      allGroupsMap.set(group.groupId, group);
    }
  });

  const finalHighlights = Array.from(allGroupsMap.values()).filter(group => {
    const deletedAt = mergedDeleted[group.groupId];
    const groupTime = group.updatedAt || 0;
    return !deletedAt || groupTime > deletedAt;
  });

  return { highlights: finalHighlights, deletedGroupIds: mergedDeleted };
}

export async function getSyncedSettings() {
  if (!hasBookmarkSyncAPI()) return null;
  return readBookmarkPayloadByTitle(SETTINGS_BOOKMARK_TITLE, null);
}

export async function saveSettingsToSync() {
  if (!hasBookmarkSyncAPI()) return;

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
    await upsertBookmarkPayload(SETTINGS_BOOKMARK_TITLE, settings);
    debugLog('Settings saved to bookmark sync:', settings);
  } catch (e) {
    debugLog('Failed to save settings to bookmark sync:', e.message);
  }
}

export async function syncSaveHighlights(url, highlights, title, lastUpdated) {
  if (!hasBookmarkSyncAPI()) return;

  const syncKey = urlToSyncKey(url);

  try {
    const [remoteData, localMetaResult] = await Promise.all([
      getRemotePageData(syncKey),
      browserAPI.storage.local.get(`${url}${STORAGE_KEYS.META_SUFFIX}`),
    ]);

    const localMeta = localMetaResult[`${url}${STORAGE_KEYS.META_SUFFIX}`] || {};

    const merged = mergeHighlights(
      { highlights, deletedGroupIds: localMeta.deletedGroupIds || {} },
      { highlights: remoteData.highlights || [], deletedGroupIds: remoteData.deletedGroupIds || {} },
    );

    const localData = {
      [url]: merged.highlights,
      [`${url}${STORAGE_KEYS.META_SUFFIX}`]: { ...localMeta, title, lastUpdated, deletedGroupIds: merged.deletedGroupIds },
    };
    await browserAPI.storage.local.set(localData);

    const pagePayload = { url, title, lastUpdated, highlights: merged.highlights, deletedGroupIds: merged.deletedGroupIds };
    const dataSize = new TextEncoder().encode(JSON.stringify({ [syncKey]: pagePayload })).byteLength;

    if (dataSize > BOOKMARK_QUOTA_BYTES_PER_ITEM) {
      debugLog('Highlight data exceeds bookmark per-item soft limit, bookmark sync skipped for:', url, `(${dataSize}B)`);
      return;
    }

    const meta = await getBookmarkSyncMeta();
    if (meta.deletedUrls[url]) delete meta.deletedUrls[url];

    let currentTotal = meta.totalSize || 0;
    const existingIdx = meta.pages.findIndex(p => p.syncKey === syncKey);
    const existingSize = existingIdx >= 0 ? (meta.pages[existingIdx].size || 0) : 0;

    while (
      (
        (currentTotal - existingSize + dataSize > BOOKMARK_HIGHLIGHT_BUDGET)
        || (existingIdx < 0 && meta.pages.length >= BOOKMARK_MAX_SYNC_PAGES)
      )
      && meta.pages.length > 0
    ) {
      meta.pages.sort((a, b) => (a.lastUpdated || '').localeCompare(b.lastUpdated || ''));
      const oldest = meta.pages.shift();
      if (!oldest || oldest.syncKey === syncKey) continue;
      currentTotal -= (oldest.size || 0);
      await removeBookmarkByTitle(oldest.syncKey);
      debugLog('Evicted oldest bookmark sync page:', oldest.syncKey, oldest.url);
    }

    const updatedBookmark = await upsertBookmarkPayload(syncKey, pagePayload);

    const pageEntry = { syncKey, url, lastUpdated, size: dataSize, bookmarkId: updatedBookmark.id };
    if (existingIdx >= 0) {
      currentTotal -= existingSize;
      meta.pages[existingIdx] = pageEntry;
    } else {
      meta.pages.push(pageEntry);
    }

    meta.totalSize = currentTotal + dataSize;
    await saveBookmarkSyncMeta(meta);
    debugLog('Highlights merged and bookmark-synced for:', url, `(${dataSize}B, total: ${meta.totalSize}B)`);
  } catch (e) {
    debugLog('Failed to bookmark-sync highlights:', e.message);
  }
}

export async function syncRemoveHighlights(url) {
  if (!hasBookmarkSyncAPI()) return;

  const syncKey = urlToSyncKey(url);

  try {
    const meta = await getBookmarkSyncMeta();
    const idx = meta.pages.findIndex(p => p.syncKey === syncKey);

    meta.deletedUrls[url] = Date.now();
    cleanupTombstones(meta.deletedUrls);

    if (idx >= 0) {
      meta.totalSize = (meta.totalSize || 0) - (meta.pages[idx].size || 0);
      meta.pages.splice(idx, 1);
    }

    await saveBookmarkSyncMeta(meta);
    await removeBookmarkByTitle(syncKey);
    debugLog('Removed highlights from bookmark sync and added tombstone for:', url);
  } catch (e) {
    debugLog('Failed to remove highlights from bookmark sync:', e.message);
  }
}

export async function cleanupEmptyHighlightData(url) {
  if (!url) return;
  try {
    await browserAPI.storage.local.remove([url, `${url}${STORAGE_KEYS.META_SUFFIX}`]);
  } catch (error) {
    debugLog('Error removing empty highlight data:', error);
  }
}

async function applyUserDeletionFromSync(url) {
  await cleanupEmptyHighlightData(url);
  await broadcastToTabsByUrl(url, { action: 'refreshHighlights', highlights: [] });
}

export async function clearAllSyncedHighlights() {
  if (!hasBookmarkSyncAPI()) return;

  try {
    const meta = await getBookmarkSyncMeta();
    const now = Date.now();

    for (const page of meta.pages) {
      if (page.url) meta.deletedUrls[page.url] = now;
      await removeBookmarkByTitle(page.syncKey);
    }

    meta.pages = [];
    meta.totalSize = 0;
    await saveBookmarkSyncMeta(meta);

    debugLog('Cleared all bookmark-synced highlights');
  } catch (e) {
    debugLog('Failed to clear bookmark-synced highlights:', e.message);
  }
}

export async function migrateLocalToSync() {
  if (!hasBookmarkSyncAPI()) return;

  const flagResult = await browserAPI.storage.local.get([
    STORAGE_KEYS.BOOKMARK_MIGRATION_DONE,
    LEGACY_SYNC_MIGRATION_KEY,
  ]);

  if (flagResult[STORAGE_KEYS.BOOKMARK_MIGRATION_DONE]) {
    if (!flagResult[LEGACY_SYNC_MIGRATION_KEY]) {
      await browserAPI.storage.local.set({ [LEGACY_SYNC_MIGRATION_KEY]: true });
    }
    return;
  }

  try {
    const syncedSettings = await getSyncedSettings();
    if (syncedSettings) {
      const localResult = await browserAPI.storage.local.get([
        STORAGE_KEYS.CUSTOM_COLORS,
        STORAGE_KEYS.MINIMAP_VISIBLE,
        STORAGE_KEYS.SELECTION_CONTROLS_VISIBLE,
      ]);

      const mergedSettings = {
        customColors: [...(localResult.customColors || [])],
        minimapVisible: syncedSettings.minimapVisible !== undefined
          ? syncedSettings.minimapVisible
          : (localResult.minimapVisible !== undefined ? localResult.minimapVisible : true),
        selectionControlsVisible: syncedSettings.selectionControlsVisible !== undefined
          ? syncedSettings.selectionControlsVisible
          : (localResult.selectionControlsVisible !== undefined ? localResult.selectionControlsVisible : true),
      };

      if (syncedSettings.customColors) {
        syncedSettings.customColors.forEach(sc => {
          if (!mergedSettings.customColors.some(lc => lc.color.toLowerCase() === sc.color.toLowerCase())) {
            mergedSettings.customColors.push(sc);
          }
        });
      }

      await browserAPI.storage.local.set(mergedSettings);
      await saveSettingsToSync();
    } else {
      await saveSettingsToSync();
    }

    const syncMeta = await getBookmarkSyncMeta();
    const allLocal = await browserAPI.storage.local.get(null);

    const remotePages = {};
    for (const page of syncMeta.pages) {
      remotePages[page.syncKey] = await getRemotePageData(page.syncKey);
    }

    const localUrls = Object.keys(allLocal).filter(k =>
      ![
        STORAGE_KEYS.CUSTOM_COLORS,
        STORAGE_KEYS.BOOKMARK_MIGRATION_DONE,
        STORAGE_KEYS.MINIMAP_VISIBLE,
        STORAGE_KEYS.SELECTION_CONTROLS_VISIBLE,
        'settings',
      ].includes(k)
      && !k.endsWith(STORAGE_KEYS.META_SUFFIX)
      && Array.isArray(allLocal[k]),
    );

    const allUrls = new Set([...localUrls, ...syncMeta.pages.map(p => p.url)]);

    for (const url of allUrls) {
      const syncKey = urlToSyncKey(url);
      const remotePageData = remotePages[syncKey] || {};
      const localHighlights = allLocal[url] || [];
      const localMeta = allLocal[`${url}${STORAGE_KEYS.META_SUFFIX}`] || {};

      if (syncMeta.deletedUrls[url] && localHighlights.length === 0) continue;

      const merged = mergeHighlights(
        { highlights: localHighlights, deletedGroupIds: localMeta.deletedGroupIds || {} },
        { highlights: remotePageData.highlights || [], deletedGroupIds: remotePageData.deletedGroupIds || {} },
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

      await syncSaveHighlights(url, merged.highlights, metaToSave.title, metaToSave.lastUpdated);
    }

    await browserAPI.storage.local.set({
      [STORAGE_KEYS.BOOKMARK_MIGRATION_DONE]: true,
      [LEGACY_SYNC_MIGRATION_KEY]: true,
    });
  } catch (e) {
    debugLog('Bookmark sync migration error:', e.message);
  }
}

function scheduleRemovalResolution(url, retryCount = 0) {
  if (!url) return;

  const existing = pendingSyncRemovalResolutions.get(url);
  if (existing) clearTimeout(existing.timeoutId);

  const timeoutId = setTimeout(async () => {
    try {
      const meta = await getBookmarkSyncMeta();
      if (meta.deletedUrls[url]) {
        await applyUserDeletionFromSync(url);
        pendingSyncRemovalResolutions.delete(url);
        return;
      }

      if (retryCount < SYNC_REMOVAL_MAX_RETRIES) {
        scheduleRemovalResolution(url, retryCount + 1);
      }
    } finally {
      const pending = pendingSyncRemovalResolutions.get(url);
      if (pending && pending.timeoutId === timeoutId) {
        pendingSyncRemovalResolutions.delete(url);
      }
    }
  }, SYNC_REMOVAL_RECHECK_DELAY_MS);

  pendingSyncRemovalResolutions.set(url, { timeoutId });
}

async function applyMetaDeletedUrls(meta) {
  for (const url of Object.keys(meta.deletedUrls || {})) {
    const local = await browserAPI.storage.local.get(url);
    if (Array.isArray(local[url]) && local[url].length > 0) {
      await applyUserDeletionFromSync(url);
    }
  }
}

export function initSyncListener({ onSettingsChanged } = {}) {
  if (!browserAPI.bookmarks) return;

  const applyBookmarkChange = async ({ title, url }) => {
    if (!title || !url) return;

    if (title === SETTINGS_BOOKMARK_TITLE) {
      const settings = decodePayloadFromDataUrl(url);
      if (settings && onSettingsChanged) await onSettingsChanged(settings);
      return;
    }

    if (title === META_BOOKMARK_TITLE) {
      const meta = normalizeSyncMeta(decodePayloadFromDataUrl(url));
      await applyMetaDeletedUrls(meta);
      return;
    }

    if (!title.startsWith(SYNC_KEYS.HIGHLIGHT_PREFIX)) return;
    const incoming = decodePayloadFromDataUrl(url);
    if (!incoming || !incoming.url) return;

    const pageUrl = incoming.url;
    const localResult = await browserAPI.storage.local.get([pageUrl, `${pageUrl}${STORAGE_KEYS.META_SUFFIX}`]);
    const localHighlights = localResult[pageUrl] || [];
    const localMeta = localResult[`${pageUrl}${STORAGE_KEYS.META_SUFFIX}`] || {};

    const merged = mergeHighlights(
      { highlights: localHighlights, deletedGroupIds: localMeta.deletedGroupIds || {} },
      { highlights: incoming.highlights || [], deletedGroupIds: incoming.deletedGroupIds || {} },
    );

    await browserAPI.storage.local.set({
      [pageUrl]: merged.highlights,
      [`${pageUrl}${STORAGE_KEYS.META_SUFFIX}`]: {
        ...localMeta,
        title: incoming.title || localMeta.title || '',
        lastUpdated: incoming.lastUpdated || localMeta.lastUpdated || '',
        deletedGroupIds: merged.deletedGroupIds,
      },
    });

    await broadcastToTabsByUrl(pageUrl, { action: 'refreshHighlights', highlights: merged.highlights });
  };

  browserAPI.bookmarks.onChanged.addListener(async (_id, changeInfo) => {
    await applyBookmarkChange(changeInfo || {});
  });

  if (browserAPI.bookmarks.onCreated && browserAPI.bookmarks.onCreated.addListener) {
    browserAPI.bookmarks.onCreated.addListener(async (_id, bookmarkNode) => {
      await applyBookmarkChange(bookmarkNode || {});
    });
  }

  browserAPI.bookmarks.onRemoved.addListener(async (_id, removeInfo) => {
    const node = removeInfo && removeInfo.node;
    if (!node || !node.title || !node.title.startsWith(SYNC_KEYS.HIGHLIGHT_PREFIX)) return;

    const oldData = decodePayloadFromDataUrl(node.url);
    if (oldData && oldData.url) {
      scheduleRemovalResolution(oldData.url);
    }
  });
}
