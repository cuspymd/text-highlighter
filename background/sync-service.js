import { browserAPI } from '../shared/browser-api.js';
import { debugLog, errorLog } from '../shared/logger.js';
import { broadcastToTabsByUrl } from '../shared/tab-broadcast.js';
import { STORAGE_KEYS, SYNC_KEYS, CLOUD_SYNC_KEYS, isPageKey } from '../constants/storage-keys.js';

const SYNC_QUOTA_BYTES_PER_ITEM = 8192;
// Reserve space for settings and sync_meta
const SYNC_HIGHLIGHT_BUDGET = 90000;
// sync_meta is one item, so it shares the per-item quota. Kept below it with
// room to spare for the key and the JSON around the tombstones.
const SYNC_META_BUDGET = 7000;
// Keep tombstones for 30 days
const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SYNC_REMOVAL_RECHECK_DELAY_MS = 500;
const SYNC_REMOVAL_MAX_RETRIES = 3;

const pendingSyncRemovalResolutions = new Map();

// SYNC_KEYS local aliases
const SYNC_SETTINGS_KEY = SYNC_KEYS.SETTINGS;

// The settings a device can be behind on. Booleans only: the shortcut map and
// the colours carry their own merge rules, and a device with none of either is
// not behind, it is empty.
const HYDRATABLE_SETTING_KEYS = [
  STORAGE_KEYS.MINIMAP_VISIBLE,
  STORAGE_KEYS.SELECTION_CONTROLS_VISIBLE,
  STORAGE_KEYS.ONE_CLICK_HIGHLIGHT,
  STORAGE_KEYS.HIDE_DEFAULT_COLORS,
];
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

export function mergeTombstonesByMax(localDeleted = {}, remoteDeleted = {}) {
  const mergedDeleted = {};
  for (const deleted of [localDeleted, remoteDeleted]) {
    for (const [id, deletedAt] of Object.entries(deleted || {})) {
      mergedDeleted[id] = Math.max(mergedDeleted[id] || 0, deletedAt || 0);
    }
  }
  cleanupTombstones(mergedDeleted);
  return mergedDeleted;
}

/**
 * sync_meta holds only the url tombstones: which removals of a highlight item
 * were the user deleting the page rather than a device making room.
 *
 * It used to list every synced page too, and that list is what outgrew the
 * 8KB per-item quota at around 55 pages - after which every meta write failed
 * and storage.sync quietly stopped tracking new pages and deletions. The list
 * is read from the items themselves now (getSyncedPages). A `pages` or
 * `totalSize` an older version wrote is dropped here and on the next write.
 */
export function normalizeSyncMeta(rawMeta) {
  const deletedUrls = rawMeta && rawMeta.deletedUrls && typeof rawMeta.deletedUrls === 'object'
    ? { ...rawMeta.deletedUrls }
    : {};
  cleanupTombstones(deletedUrls);
  return { deletedUrls };
}

function syncItemSize(syncKey, data) {
  return new TextEncoder().encode(JSON.stringify({ [syncKey]: data })).byteLength;
}

/**
 * Keep the newest tombstones that fit in the meta item. A url tombstone only
 * has to outlive the few seconds another device takes to tell a deletion from
 * an eviction, and cloud sync keeps tombstones of its own, so the oldest are
 * the ones to give up.
 */
export function fitSyncMeta(meta) {
  const encoder = new TextEncoder();
  const entries = Object.entries(normalizeSyncMeta(meta).deletedUrls)
    .sort((a, b) => b[1] - a[1]);
  const deletedUrls = {};
  let size = encoder.encode(JSON.stringify({ [SYNC_META_KEY]: { deletedUrls: {} } })).byteLength;
  for (const [url, deletedAt] of entries) {
    const entrySize = encoder.encode(`${JSON.stringify(url)}:${deletedAt},`).byteLength;
    if (size + entrySize > SYNC_META_BUDGET) break;
    deletedUrls[url] = deletedAt;
    size += entrySize;
  }
  return { deletedUrls };
}

async function setSyncMeta(meta) {
  await browserAPI.storage.sync.set({ [SYNC_META_KEY]: fitSyncMeta(meta) });
}

/**
 * The highlight items in storage.sync, oldest first, each with its size as it
 * counts against the quota. Read from storage.sync itself, so the list cannot
 * drift from what is really there. storage.sync holds at most ~100KB and reads
 * are not rate limited, so reading it whole on every save is cheap.
 */
export async function getSyncedPages() {
  const all = await browserAPI.storage.sync.get(null);
  return Object.entries(all || {})
    .filter(([key, data]) => key.startsWith(SYNC_HIGHLIGHT_PREFIX) && data && typeof data === 'object')
    .map(([syncKey, data]) => ({
      syncKey,
      url: data.url,
      lastUpdated: data.lastUpdated || '',
      size: syncItemSize(syncKey, data),
      data,
    }))
    .sort((a, b) => a.lastUpdated.localeCompare(b.lastUpdated));
}

export function toSyncHighlightGroup(group) {
  if (!group.selectors || !group.selectors.quote) {
    return group;
  }
  const { spans, ...rest } = group;
  return rest;
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

  // 1. Merge deleted markers (Tombstones) - Union by newest timestamp and Cleanup
  const mergedDeleted = mergeTombstonesByMax(localDeleted, remoteDeleted);

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
    STORAGE_KEYS.ONE_CLICK_HIGHLIGHT,
    STORAGE_KEYS.HIDE_DEFAULT_COLORS,
    STORAGE_KEYS.SHORTCUT_COLOR_MAP,
  ]);
  const settings = {
    customColors: result.customColors || [],
    minimapVisible: result.minimapVisible !== undefined ? result.minimapVisible : true,
    selectionControlsVisible: result.selectionControlsVisible !== undefined ? result.selectionControlsVisible : true,
  };

  // storage.sync.set replaces the whole settings object, so a key this device
  // has no value for must not go out as its default: that would push "off" over
  // a setting another device turned on. Until this device has an opinion of its
  // own, whatever sync already holds stands. Every profile that upgrades into
  // the one-click setting starts out without it, which is what makes this reach
  // further than the shortcut map it was written for.
  //
  // The local value arrives the ordinary way - applySettingsFromSync writes it
  // when the sync change lands - and from then on it is the one that goes out.
  const localOneClick = result.oneClickHighlightEnabled;
  const localHideDefaults = result.hideDefaultColors;
  let remoteSettings = null;
  if (localOneClick === undefined || localHideDefaults === undefined || !result.shortcutColorMap) {
    try {
      const syncResult = await browserAPI.storage.sync.get(SYNC_SETTINGS_KEY);
      remoteSettings = syncResult[SYNC_SETTINGS_KEY] || null;
    } catch (e) {
      remoteSettings = null;
    }
  }

  if (localOneClick !== undefined) {
    settings.oneClickHighlightEnabled = localOneClick === true;
  } else if (remoteSettings && remoteSettings.oneClickHighlightEnabled !== undefined) {
    settings.oneClickHighlightEnabled = remoteSettings.oneClickHighlightEnabled === true;
  }

  if (localHideDefaults !== undefined) {
    settings.hideDefaultColors = localHideDefaults === true;
  } else if (remoteSettings && remoteSettings.hideDefaultColors !== undefined) {
    settings.hideDefaultColors = remoteSettings.hideDefaultColors === true;
  }

  if (result.shortcutColorMap) {
    settings.shortcutColorMap = result.shortcutColorMap;
  } else {
    settings.shortcutColorMap = (remoteSettings && remoteSettings.shortcutColorMap) || null;
  }

  // Recorded regardless of storage.sync outcome so the cloud sync blob (which has no
  // event-based change detection of its own) can tell whose settings are newest.
  await browserAPI.storage.local.set({ [CLOUD_SYNC_KEYS.SETTINGS_UPDATED_AT]: Date.now() });

  try {
    await browserAPI.storage.sync.set({ [SYNC_SETTINGS_KEY]: settings });
    debugLog('Settings saved to sync:', settings);
  } catch (e) {
    errorLog('Failed to save settings to sync:', e.message);
  }
}

// Settings that sync knows about and this device has never been told.
//
// A key introduced after a profile migrated stays absent locally: the migration
// runs once, and applySettingsFromSync only fires when a sync *change* arrives -
// a value another device chose before this one upgraded is simply already
// there, with no change to hear. The settings page and the content scripts read
// local storage, so until something writes it this device shows and runs the
// setting as off while sync says otherwise.
//
// Only keys with no local value are reported. A key this device has an opinion
// about is its own business, and last-write-wins already governs those.
export async function getSettingsMissingLocally() {
  let syncSettings = null;
  try {
    const syncResult = await browserAPI.storage.sync.get(SYNC_SETTINGS_KEY);
    syncSettings = syncResult[SYNC_SETTINGS_KEY] || null;
  } catch (e) {
    errorLog('Could not read sync settings to catch up with:', e.message);
    return null;
  }
  if (!syncSettings) return null;

  const local = await browserAPI.storage.local.get(HYDRATABLE_SETTING_KEYS);
  const missing = {};
  HYDRATABLE_SETTING_KEYS.forEach((key) => {
    if (local[key] === undefined && syncSettings[key] !== undefined) {
      missing[key] = syncSettings[key];
    }
  });

  return Object.keys(missing).length > 0 ? missing : null;
}

/**
 * Record a local tombstone for cloud sync (Cloudflare KV blob), independent of
 * browser storage.sync's own tombstone bookkeeping (sync_meta.deletedUrls).
 * Returns whether the write succeeded so callers can retry (e.g. once the
 * page's own highlight payload has been freed from storage.local, which is
 * the most common reason this small write would fail: local storage sitting
 * at or near its quota).
 */
export async function recordCloudSyncTombstones(urls) {
  try {
    const result = await browserAPI.storage.local.get(CLOUD_SYNC_KEYS.DELETED_URLS);
    const deletedUrls = result[CLOUD_SYNC_KEYS.DELETED_URLS] || {};
    const now = Date.now();
    for (const url of urls) deletedUrls[url] = now;
    cleanupTombstones(deletedUrls);
    await browserAPI.storage.local.set({ [CLOUD_SYNC_KEYS.DELETED_URLS]: deletedUrls });
    return true;
  } catch (e) {
    errorLog('Failed to record cloud sync tombstone(s):', e.message);
    return false;
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

    const syncHighlights = merged.highlights.map(toSyncHighlightGroup);

    const data = { url, title, lastUpdated, highlights: syncHighlights, deletedGroupIds: merged.deletedGroupIds };
    const dataSize = syncItemSize(syncKey, data);

    if (dataSize > SYNC_QUOTA_BYTES_PER_ITEM) {
      debugLog('Highlight data exceeds 8KB per-item limit, sync skipped for:', url, `(${dataSize}B)`);
      return;
    }

    const localData = {};
    localData[url] = merged.highlights;
    localData[`${url}${STORAGE_KEYS.META_SUFFIX}`] = { ...localMeta, title, lastUpdated, deletedGroupIds: merged.deletedGroupIds };
    await browserAPI.storage.local.set(localData);

    // This page's own item is about to be replaced, so neither its old size
    // nor the item itself is part of the room to make.
    const others = (await getSyncedPages()).filter(page => page.syncKey !== syncKey);
    let totalSize = others.reduce((sum, page) => sum + page.size, 0);

    while (totalSize + dataSize > SYNC_HIGHLIGHT_BUDGET && others.length > 0) {
      const oldest = others.shift();
      try {
        await browserAPI.storage.sync.remove(oldest.syncKey);
        totalSize -= oldest.size;
        debugLog('Evicted oldest sync page:', oldest.syncKey, oldest.url);
      } catch (e) {
        errorLog('Error evicting sync page:', e.message);
      }
    }

    await browserAPI.storage.sync.set({ [syncKey]: data });

    // Only written when there is a tombstone to clear, so an ordinary save
    // costs one sync write rather than two.
    const meta = await getSyncMeta();
    if (meta.deletedUrls[url]) {
      delete meta.deletedUrls[url];
      await setSyncMeta(meta);
    }
    debugLog('Highlights merged and synced for:', url, `(${dataSize}B, total: ${totalSize + dataSize}B)`);
  } catch (e) {
    errorLog('Failed to sync highlights:', e.message);
  }
}

/**
 * @returns {Promise<boolean>} whether the cloud sync tombstone write succeeded.
 *   If false, the caller should retry recordCloudSyncTombstones([url]) after
 *   freeing local storage (e.g. after cleanupEmptyHighlightData), since the
 *   most likely failure cause — storage.local at/near quota — no longer
 *   applies once the page's own highlight payload has been removed.
 */
export async function syncRemoveHighlights(url) {
  // Recorded first (a local-only write) so a runCloudSync() that races this
  // function always sees the tombstone before it sees the highlights gone from
  // storage.local, and correctly treats the page as deleted instead of
  // resurrecting it from the still-present remote copy.
  const tombstoneRecorded = await recordCloudSyncTombstones([url]);

  const syncKey = urlToSyncKey(url);
  try {
    const existing = await browserAPI.storage.sync.get(syncKey);
    if (!existing[syncKey]) return tombstoneRecorded;

    // The tombstone goes first, so another device that sees the item go
    // already finds it and treats the removal as a deletion. A tombstone that
    // cannot be written does not keep the item: the other devices then take
    // the removal for an eviction and keep their copy, which is still better
    // than storage.sync holding the deleted page for good.
    const meta = await getSyncMeta();
    meta.deletedUrls[url] = Date.now();
    try {
      await setSyncMeta(meta);
    } catch (e) {
      debugLog('Failed to record sync tombstone:', e.message);
    }
    await browserAPI.storage.sync.remove(syncKey);
    debugLog('Removed highlights from sync and added tombstone for:', url);
  } catch (e) {
    errorLog('Failed to remove highlights from sync:', e.message);
  }

  return tombstoneRecorded;
}

export async function cleanupEmptyHighlightData(url) {
  if (!url) return;
  debugLog('Cleaning up empty highlight data for URL:', url);
  try {
    await browserAPI.storage.local.remove([url, `${url}${STORAGE_KEYS.META_SUFFIX}`]);
    debugLog('Successfully removed empty highlight data for URL:', url);
  } catch (error) {
    errorLog('Error removing empty highlight data:', error);
  }
}

async function applyUserDeletionFromSync(url) {
  await cleanupEmptyHighlightData(url);
  await broadcastToTabsByUrl(url, { action: 'refreshHighlights', highlights: [] });
}

/**
 * Clear all synced highlights and mark synced URLs as user-deleted.
 * Sync tombstones are written only for the pages that have an item in
 * storage.sync, and only as many as fit in the sync_meta item.
 *
 * @param {string[]} localUrls - All locally known highlighted page URLs at the time of
 *   clearing (may be a superset of the synced pages, e.g. pages that never fit the 8KB
 *   per-item browser sync limit). Used to record cloud sync tombstones for every page,
 *   since the Cloudflare KV blob has no per-item size limit of its own.
 * @returns {Promise<boolean>} whether the cloud sync tombstone write succeeded.
 *   If false, the caller should retry recordCloudSyncTombstones(localUrls) after
 *   freeing local storage — see syncRemoveHighlights for why.
 */
export async function clearAllSyncedHighlights(localUrls = []) {
  // Recorded first, before any storage.sync round-trip or local removal — see
  // the comment in syncRemoveHighlights for why the ordering matters.
  const tombstoneRecorded = await recordCloudSyncTombstones(localUrls);

  try {
    const pages = await getSyncedPages();
    if (pages.length > 0) {
      const meta = await getSyncMeta();
      const now = Date.now();
      for (const page of pages) {
        if (page.url) meta.deletedUrls[page.url] = now;
      }
      // fitSyncMeta keeps as many as the item holds; past roughly ninety
      // pages the rest reach the other devices as evictions, not deletions.
      try {
        await setSyncMeta(meta);
      } catch (e) {
        debugLog('Failed to record sync tombstones:', e.message);
      }
      await browserAPI.storage.sync.remove(pages.map(page => page.syncKey));
    }
    debugLog('Cleared all synced highlights');
  } catch (e) {
    errorLog('Failed to clear synced highlights:', e.message);
  }

  return tombstoneRecorded;
}

/**
 * Initial synchronization on first run or fresh install.
 * Satisfies Rule S-9 and M-1.
 *
 * Returns the settings it merged in from sync, or null when there were none.
 * They are written to local storage only: the settings service has already
 * loaded its in-memory copy and built the context menu by now, and no sync
 * change event follows when the value written back equals what sync held. The
 * caller applies them, which is what puts them in front of the menu.
 */
export async function migrateLocalToSync() {
  const flagResult = await browserAPI.storage.local.get(STORAGE_KEYS.SYNC_MIGRATION_DONE);
  if (flagResult.syncMigrationDone) return null;

  let adoptedSettings = null;
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
        STORAGE_KEYS.ONE_CLICK_HIGHLIGHT,
        STORAGE_KEYS.HIDE_DEFAULT_COLORS,
        STORAGE_KEYS.SHORTCUT_COLOR_MAP,
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

      // Only when one of the two sides actually chose one. Writing the default
      // here turns "nobody has an opinion" into a local `false` with a fresh
      // settings timestamp, which would then win the merge against a cloud
      // snapshot that has the setting on - and disable it everywhere.
      if (syncSettings.oneClickHighlightEnabled !== undefined) {
        mergedSettings.oneClickHighlightEnabled = syncSettings.oneClickHighlightEnabled;
      } else if (localResult.oneClickHighlightEnabled !== undefined) {
        mergedSettings.oneClickHighlightEnabled = localResult.oneClickHighlightEnabled;
      }

      if (syncSettings.hideDefaultColors !== undefined) {
        mergedSettings.hideDefaultColors = syncSettings.hideDefaultColors;
      } else if (localResult.hideDefaultColors !== undefined) {
        mergedSettings.hideDefaultColors = localResult.hideDefaultColors;
      }

      if (syncSettings.shortcutColorMap !== undefined && syncSettings.shortcutColorMap !== null) {
        mergedSettings.shortcutColorMap = syncSettings.shortcutColorMap;
      } else if (localResult.shortcutColorMap) {
        mergedSettings.shortcutColorMap = localResult.shortcutColorMap;
      }

      if (syncSettings.customColors) {
        syncSettings.customColors.forEach(sc => {
          const localMatch = mergedSettings.customColors.find(lc => lc.color.toLowerCase() === sc.color.toLowerCase());
          if (!localMatch) {
            mergedSettings.customColors.push(sc);
          } else if (sc.customName && !localMatch.customName) {
            // Only adopt sync's custom name if the local color doesn't already have one
            // to avoid overwriting a user's recent local rename with stale sync data.
            localMatch.customName = sc.customName;
          }
        });
      }

      await browserAPI.storage.local.set(mergedSettings);
      adoptedSettings = mergedSettings;
      await saveSettingsToSync();
    } else {
      await saveSettingsToSync();
    }

    const syncMeta = await getSyncMeta();
    const syncedPages = await getSyncedPages();
    const allLocal = await browserAPI.storage.local.get(null);

    const syncData = {};
    syncedPages.forEach(page => { syncData[page.syncKey] = page.data; });

    const localUrls = Object.keys(allLocal).filter(k => isPageKey(k, allLocal[k]));

    const allUrls = new Set([...localUrls, ...syncedPages.map(page => page.url).filter(Boolean)]);

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
    errorLog('Sync migration error:', e.message);
  }

  return adoptedSettings;
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
        errorLog('Error resolving sync removal for:', url, e.message);
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
