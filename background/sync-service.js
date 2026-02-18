import { browserAPI } from '../shared/browser-api.js';
import { debugLog } from '../shared/logger.js';
import { broadcastToTabsByUrl } from '../shared/tab-broadcast.js';
import { STORAGE_KEYS, SYNC_KEYS } from '../constants/storage-keys.js';

const SYNC_QUOTA_BYTES_PER_ITEM = 8192;
// Reserve space for settings and sync_meta
const SYNC_HIGHLIGHT_BUDGET = 90000;
// Keep tombstones for 30 days
const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SYNC_REMOVAL_RECHECK_DELAY_MS = 500;
const SYNC_REMOVAL_MAX_RETRIES = 3;

const pendingSyncRemovalResolutions = new Map();

// SYNC_KEYS local aliases
const SYNC_SETTINGS_KEY = SYNC_KEYS.SETTINGS;
const SYNC_HIGHLIGHT_PREFIX = SYNC_KEYS.HIGHLIGHT_PREFIX;
const SYNC_META_KEY = SYNC_KEYS.META;

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
  return SYNC_HIGHLIGHT_PREFIX + Math.abs(hash).toString(36);
}

/**
 * Merges two sets of highlights and deleted markers based on timestamps.
 * Implements Conflict Resolution Rule 4.1.
 */
export function mergeHighlights(localData, remoteData) {
  const localHighlights = localData.highlights || [];
  const remoteHighlights = remoteData.highlights || [];
  const localDeleted = localData.deletedGroupIds || {};
  const remoteDeleted = remoteData.deletedGroupIds || {};

  // 1. Merge deleted markers (Tombstones) - Union and Cleanup
  const mergedDeleted = { ...localDeleted, ...remoteDeleted };
  cleanupTombstones(mergedDeleted);

  // 2. Combine all highlight groups, favoring newer versions
  const allGroupsMap = new Map();
  [...localHighlights, ...remoteHighlights].forEach(group => {
    const existing = allGroupsMap.get(group.groupId);
    const groupTime = group.updatedAt || 0;
    const existingTime = existing ? (existing.updatedAt || 0) : -1;
    if (!existing || groupTime > existingTime) {
      allGroupsMap.set(group.groupId, group);
    }
  });

  // 3. Filter out deleted highlights unless re-created after deletion
  const finalHighlights = Array.from(allGroupsMap.values()).filter(group => {
    const deletedAt = mergedDeleted[group.groupId];
    const groupTime = group.updatedAt || 0;
    return !deletedAt || groupTime > deletedAt;
  });

  return { highlights: finalHighlights, deletedGroupIds: mergedDeleted };
}

async function getSyncMeta() {
  try {
    const result = await browserAPI.storage.sync.get(SYNC_META_KEY);
    return normalizeSyncMeta(result[SYNC_META_KEY]);
  } catch (e) {
    return normalizeSyncMeta();
  }
}

export async function saveSettingsToSync() {
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
    await browserAPI.storage.sync.set({ [SYNC_SETTINGS_KEY]: settings });
    debugLog('Settings saved to sync:', settings);
  } catch (e) {
    debugLog('Failed to save settings to sync:', e.message);
  }
}

export async function syncSaveHighlights(url, highlights, title, lastUpdated) {
  const syncKey = urlToSyncKey(url);
  try {
    const [syncResult, localMetaResult] = await Promise.all([
      browserAPI.storage.sync.get(syncKey),
      browserAPI.storage.local.get(`${url}${STORAGE_KEYS.META_SUFFIX}`),
    ]);

    const remoteData = syncResult[syncKey] || {};
    const localMeta = localMetaResult[`${url}${STORAGE_KEYS.META_SUFFIX}`] || {};

    const merged = mergeHighlights(
      { highlights, deletedGroupIds: localMeta.deletedGroupIds || {} },
      { highlights: remoteData.highlights || [], deletedGroupIds: remoteData.deletedGroupIds || {} }
    );

    const data = { url, title, lastUpdated, highlights: merged.highlights, deletedGroupIds: merged.deletedGroupIds };
    const dataStr = JSON.stringify({ [syncKey]: data });
    const dataSize = new TextEncoder().encode(dataStr).byteLength;

    if (dataSize > SYNC_QUOTA_BYTES_PER_ITEM) {
      debugLog('Highlight data exceeds 8KB per-item limit, sync skipped for:', url, `(${dataSize}B)`);
      return;
    }

    const localData = {};
    localData[url] = merged.highlights;
    localData[`${url}${STORAGE_KEYS.META_SUFFIX}`] = { ...localMeta, title, lastUpdated, deletedGroupIds: merged.deletedGroupIds };
    await browserAPI.storage.local.set(localData);

    const meta = await getSyncMeta();
    let totalSize = meta.totalSize || 0;
    cleanupTombstones(meta.deletedUrls);
    if (meta.deletedUrls && meta.deletedUrls[url]) {
      delete meta.deletedUrls[url];
    }

    while (totalSize + dataSize > SYNC_HIGHLIGHT_BUDGET && meta.pages.length > 0) {
      meta.pages.sort((a, b) => (a.lastUpdated || '').localeCompare(b.lastUpdated || ''));
      const oldest = meta.pages.shift();
      try {
        await browserAPI.storage.sync.remove(oldest.syncKey);
        totalSize -= (oldest.size || 0);
        debugLog('Evicted oldest sync page:', oldest.syncKey, oldest.url);
      } catch (e) {
        debugLog('Error evicting sync page:', e.message);
      }
    }

    await browserAPI.storage.sync.set({ [syncKey]: data });

    const existingIdx = meta.pages.findIndex(p => p.syncKey === syncKey);
    const pageEntry = { syncKey, url, lastUpdated, size: dataSize };
    if (existingIdx >= 0) {
      totalSize -= (meta.pages[existingIdx].size || 0);
      meta.pages[existingIdx] = pageEntry;
    } else {
      meta.pages.push(pageEntry);
    }
    meta.totalSize = totalSize + dataSize;

    await browserAPI.storage.sync.set({ [SYNC_META_KEY]: meta });
    debugLog('Highlights merged and synced for:', url, `(${dataSize}B, total: ${meta.totalSize}B)`);
  } catch (e) {
    debugLog('Failed to sync highlights:', e.message);
  }
}

export async function syncRemoveHighlights(url) {
  const syncKey = urlToSyncKey(url);
  try {
    const meta = await getSyncMeta();
    const idx = meta.pages.findIndex(p => p.syncKey === syncKey);

    if (!meta.deletedUrls) meta.deletedUrls = {};
    meta.deletedUrls[url] = Date.now();
    cleanupTombstones(meta.deletedUrls);

    if (idx >= 0) {
      meta.totalSize = (meta.totalSize || 0) - (meta.pages[idx].size || 0);
      meta.pages.splice(idx, 1);
    }

    await browserAPI.storage.sync.set({ [SYNC_META_KEY]: meta });
    await browserAPI.storage.sync.remove(syncKey);
    debugLog('Removed highlights from sync and added tombstone for:', url);
  } catch (e) {
    debugLog('Failed to remove highlights from sync:', e.message);
  }
}

export async function cleanupEmptyHighlightData(url) {
  if (!url) return;
  debugLog('Cleaning up empty highlight data for URL:', url);
  try {
    await browserAPI.storage.local.remove([url, `${url}${STORAGE_KEYS.META_SUFFIX}`]);
    debugLog('Successfully removed empty highlight data for URL:', url);
  } catch (error) {
    debugLog('Error removing empty highlight data:', error);
  }
}

async function applyUserDeletionFromSync(url) {
  await cleanupEmptyHighlightData(url);
  await broadcastToTabsByUrl(url, { action: 'refreshHighlights', highlights: [] });
}

/**
 * Clear all synced highlights and mark synced URLs as user-deleted.
 * Tombstones are written only for URLs currently tracked in sync_meta.pages
 * to keep the sync_meta item within per-item quota.
 */
export async function clearAllSyncedHighlights() {
  try {
    const meta = await getSyncMeta();
    const syncKeysToRemove = meta.pages.map(p => p.syncKey);

    const now = Date.now();
    for (const page of meta.pages) {
      if (page.url) meta.deletedUrls[page.url] = now;
    }

    await browserAPI.storage.sync.set({ [SYNC_META_KEY]: meta });

    if (syncKeysToRemove.length > 0) {
      await browserAPI.storage.sync.remove(syncKeysToRemove);
    }

    await browserAPI.storage.sync.set({ [SYNC_META_KEY]: { ...meta, pages: [], totalSize: 0 } });
    debugLog('Cleared all synced highlights');
  } catch (e) {
    debugLog('Failed to clear synced highlights:', e.message);
  }
}

/**
 * Initial synchronization on first run or fresh install.
 * Satisfies Rule S-9 and M-1.
 */
export async function migrateLocalToSync() {
  const flagResult = await browserAPI.storage.local.get(STORAGE_KEYS.SYNC_MIGRATION_DONE);
  if (flagResult.syncMigrationDone) return;

  debugLog('Starting initial sync migration and pull...');
  try {
    const syncSettingsResult = await browserAPI.storage.sync.get(SYNC_SETTINGS_KEY);
    const syncSettings = syncSettingsResult[SYNC_SETTINGS_KEY];

    if (syncSettings) {
      debugLog('Found sync settings, applying...');
      const localResult = await browserAPI.storage.local.get([
        STORAGE_KEYS.CUSTOM_COLORS,
        STORAGE_KEYS.MINIMAP_VISIBLE,
        STORAGE_KEYS.SELECTION_CONTROLS_VISIBLE,
      ]);

      const mergedSettings = {
        customColors: [...(localResult.customColors || [])],
        minimapVisible: syncSettings.minimapVisible !== undefined
          ? syncSettings.minimapVisible
          : (localResult.minimapVisible !== undefined ? localResult.minimapVisible : true),
        selectionControlsVisible: syncSettings.selectionControlsVisible !== undefined
          ? syncSettings.selectionControlsVisible
          : (localResult.selectionControlsVisible !== undefined ? localResult.selectionControlsVisible : true),
      };

      if (syncSettings.customColors) {
        syncSettings.customColors.forEach(sc => {
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

    const syncMeta = await getSyncMeta();
    const allLocal = await browserAPI.storage.local.get(null);

    let syncData = {};
    if (syncMeta.pages.length > 0) {
      const keys = syncMeta.pages.map(p => p.syncKey);
      syncData = await browserAPI.storage.sync.get(keys);
    }

    const localUrls = Object.keys(allLocal).filter(k =>
      ![
        STORAGE_KEYS.CUSTOM_COLORS,
        STORAGE_KEYS.SYNC_MIGRATION_DONE,
        STORAGE_KEYS.MINIMAP_VISIBLE,
        STORAGE_KEYS.SELECTION_CONTROLS_VISIBLE,
        'settings',
      ].includes(k) &&
      !k.endsWith(STORAGE_KEYS.META_SUFFIX) &&
      Array.isArray(allLocal[k])
    );

    const allUrls = new Set([...localUrls, ...syncMeta.pages.map(p => p.url)]);

    for (const url of allUrls) {
      const syncKey = urlToSyncKey(url);
      const remotePageData = syncData[syncKey] || {};
      const localHighlights = allLocal[url] || [];
      const localMeta = allLocal[`${url}${STORAGE_KEYS.META_SUFFIX}`] || {};

      if (syncMeta.deletedUrls && syncMeta.deletedUrls[url] && localHighlights.length === 0) continue;

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

      await syncSaveHighlights(url, merged.highlights, metaToSave.title, metaToSave.lastUpdated);
    }

    await browserAPI.storage.local.set({ syncMigrationDone: true });
    debugLog('Initial sync migration and pull completed.');
  } catch (e) {
    debugLog('Sync migration error:', e.message);
  }
}

/**
 * Register the storage.onChanged listener for cross-device sync.
 * @param {object} callbacks
 * @param {function} callbacks.onSettingsChanged - Called with new settings when sync settings change.
 */
export function initSyncListener({ onSettingsChanged } = {}) {
  const scheduleRemovalResolution = (oldData, retryCount = 0) => {
    if (!oldData || !oldData.url) return;
    const url = oldData.url;

    const existing = pendingSyncRemovalResolutions.get(url);
    if (existing) clearTimeout(existing.timeoutId);

    const timeoutId = setTimeout(async () => {
      try {
        const meta = await getSyncMeta();
        if (meta.deletedUrls && meta.deletedUrls[url]) {
          debugLog('Confirmed user-initiated deletion for:', url);
          await applyUserDeletionFromSync(url);
          pendingSyncRemovalResolutions.delete(url);
          return;
        }

        if (retryCount < SYNC_REMOVAL_MAX_RETRIES) {
          scheduleRemovalResolution(oldData, retryCount + 1);
          return;
        }

        debugLog('Sync removal treated as eviction after retries. Keeping local data for:', url);
      } catch (e) {
        debugLog('Error resolving sync removal for:', url, e.message);
      } finally {
        const pending = pendingSyncRemovalResolutions.get(url);
        if (pending && pending.timeoutId === timeoutId) {
          pendingSyncRemovalResolutions.delete(url);
        }
      }
    }, SYNC_REMOVAL_RECHECK_DELAY_MS);

    pendingSyncRemovalResolutions.set(url, { timeoutId });
  };

  browserAPI.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'sync') return;
    debugLog('Sync storage changed:', Object.keys(changes));

    if (changes[SYNC_SETTINGS_KEY]) {
      const newSettings = changes[SYNC_SETTINGS_KEY].newValue;
      if (newSettings && onSettingsChanged) {
        await onSettingsChanged(newSettings);
      }
    }

    for (const key of Object.keys(changes)) {
      if (!key.startsWith(SYNC_HIGHLIGHT_PREFIX)) continue;

      const newData = changes[key].newValue;
      if (newData && newData.url) {
        const url = newData.url;
        const localResult = await browserAPI.storage.local.get([url, `${url}${STORAGE_KEYS.META_SUFFIX}`]);
        const localHighlights = localResult[url] || [];
        const localMeta = localResult[`${url}${STORAGE_KEYS.META_SUFFIX}`] || {};

        const merged = mergeHighlights(
          { highlights: localHighlights, deletedGroupIds: localMeta.deletedGroupIds || {} },
          { highlights: newData.highlights || [], deletedGroupIds: newData.deletedGroupIds || {} }
        );

        const saveData = {};
        saveData[url] = merged.highlights;
        saveData[`${url}${STORAGE_KEYS.META_SUFFIX}`] = {
          ...localMeta,
          title: newData.title || localMeta.title || '',
          lastUpdated: newData.lastUpdated || localMeta.lastUpdated || '',
          deletedGroupIds: merged.deletedGroupIds,
        };
        await browserAPI.storage.local.set(saveData);
        debugLog('Synced highlights merged and applied for:', url);

        await broadcastToTabsByUrl(url, { action: 'refreshHighlights', highlights: merged.highlights });
      } else if (!newData) {
        const oldData = changes[key].oldValue;
        if (oldData && oldData.url) {
          scheduleRemovalResolution(oldData);
        }
      }
    }
  });
}
