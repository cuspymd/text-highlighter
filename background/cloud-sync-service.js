import { browserAPI } from '../shared/browser-api.js';
import { debugLog } from '../shared/logger.js';
import { broadcastToTabsByUrl } from '../shared/tab-broadcast.js';
import { STORAGE_KEYS, CLOUD_SYNC_KEYS } from '../constants/storage-keys.js';
import {
  CLOUD_SYNC_ENDPOINT_BASE,
  CLOUD_SYNC_ALARM_NAME,
  CLOUD_SYNC_ALARM_PERIOD_MINUTES,
  CLOUD_SYNC_MAX_BODY_BYTES,
} from '../constants/cloud-sync-config.js';
import { generateSyncCode, deriveSyncKeys, encryptBlob, decryptBlob } from '../shared/crypto-utils.js';
import { mergeHighlights, cleanupTombstones, mergeTombstonesByMax } from './sync-service.js';
import { applySettingsFromSync, createOrUpdateContextMenus } from './settings-service.js';

const LOCAL_ONLY_KEYS = new Set([
  STORAGE_KEYS.CUSTOM_COLORS,
  STORAGE_KEYS.SYNC_MIGRATION_DONE,
  STORAGE_KEYS.MINIMAP_VISIBLE,
  STORAGE_KEYS.SELECTION_CONTROLS_VISIBLE,
  STORAGE_KEYS.SHORTCUT_COLOR_MAP,
  CLOUD_SYNC_KEYS.ENABLED,
  CLOUD_SYNC_KEYS.CODE,
  CLOUD_SYNC_KEYS.LAST_SYNCED_AT,
  CLOUD_SYNC_KEYS.LAST_ERROR,
  CLOUD_SYNC_KEYS.LAST_ERROR_DETAILS,
  CLOUD_SYNC_KEYS.DELETED_URLS,
  CLOUD_SYNC_KEYS.SETTINGS_UPDATED_AT,
  'settings', // storage.sync settings payload key, never present in storage.local but guard anyway
]);

const CLOUD_SYNC_DATA_TOO_LARGE = 'CLOUD_SYNC_DATA_TOO_LARGE';

function byteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}

function formatBytes(bytes) {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} bytes`;
}

function createCloudSyncSizeError(currentBytes, maxBytes) {
  const error = new Error(
    `Cloud sync data too large (${formatBytes(currentBytes)} / ${formatBytes(maxBytes)} limit)`
  );
  error.code = CLOUD_SYNC_DATA_TOO_LARGE;
  error.currentBytes = currentBytes;
  error.maxBytes = maxBytes;
  return error;
}

function getErrorDetails(error) {
  if (error.code !== CLOUD_SYNC_DATA_TOO_LARGE) return null;
  return {
    code: error.code,
    currentBytes: error.currentBytes,
    maxBytes: error.maxBytes,
  };
}

function emptyBlob() {
  return {
    version: 1,
    updatedAt: 0,
    settings: {
      customColors: [],
      minimapVisible: true,
      selectionControlsVisible: true,
      shortcutColorMap: null,
      updatedAt: 0,
    },
    pages: {},
    deletedUrls: {},
  };
}

/**
 * Build the full local blob to be encrypted and pushed, mirroring the shape
 * described in arch-docs/cloudflare-kv-based-sync-design.md section 4.
 */
async function buildLocalBlob() {
  const all = await browserAPI.storage.local.get(null);

  const pages = {};
  for (const key of Object.keys(all)) {
    if (LOCAL_ONLY_KEYS.has(key)) continue;
    if (key.endsWith(STORAGE_KEYS.META_SUFFIX)) continue;
    if (!Array.isArray(all[key])) continue;

    const url = key;
    const meta = all[`${url}${STORAGE_KEYS.META_SUFFIX}`] || {};
    pages[url] = {
      title: meta.title || '',
      lastUpdated: meta.lastUpdated || '',
      highlights: all[url],
      deletedGroupIds: meta.deletedGroupIds || {},
    };
  }

  const deletedUrls = all[CLOUD_SYNC_KEYS.DELETED_URLS] || {};
  cleanupTombstones(deletedUrls);

  return {
    version: 1,
    updatedAt: Date.now(),
    settings: {
      customColors: all[STORAGE_KEYS.CUSTOM_COLORS] || [],
      minimapVisible: all[STORAGE_KEYS.MINIMAP_VISIBLE] !== undefined ? all[STORAGE_KEYS.MINIMAP_VISIBLE] : true,
      selectionControlsVisible: all[STORAGE_KEYS.SELECTION_CONTROLS_VISIBLE] !== undefined
        ? all[STORAGE_KEYS.SELECTION_CONTROLS_VISIBLE]
        : true,
      shortcutColorMap: all[STORAGE_KEYS.SHORTCUT_COLOR_MAP] || null,
      updatedAt: all[CLOUD_SYNC_KEYS.SETTINGS_UPDATED_AT] || 0,
    },
    pages,
    deletedUrls,
  };
}

function pageTimestamp(page) {
  if (!page || !page.lastUpdated) return 0;
  const t = new Date(page.lastUpdated).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Merge local and remote blobs. Per-page highlight merging reuses mergeHighlights
 * (the same conflict resolution used by browser storage.sync). Page-level tombstones
 * are resolved the same way mergeHighlights resolves group-level tombstones: a
 * deletion wins unless one side has since recreated the page with a newer lastUpdated.
 */
export function mergeBlobs(localBlob, remoteBlob) {
  const deletedUrls = mergeTombstonesByMax(localBlob.deletedUrls, remoteBlob.deletedUrls);

  const allUrls = new Set([...Object.keys(localBlob.pages), ...Object.keys(remoteBlob.pages)]);
  const pages = {};

  for (const url of allUrls) {
    const localPage = localBlob.pages[url];
    const remotePage = remoteBlob.pages[url];

    const deletedAt = deletedUrls[url];
    const localTime = pageTimestamp(localPage);
    const remoteTime = pageTimestamp(remotePage);

    if (deletedAt && deletedAt > Math.max(localTime, remoteTime)) {
      continue; // Neither side has touched this page since the deletion; stays deleted.
    }

    const merged = mergeHighlights(
      { highlights: (localPage && localPage.highlights) || [], deletedGroupIds: (localPage && localPage.deletedGroupIds) || {} },
      { highlights: (remotePage && remotePage.highlights) || [], deletedGroupIds: (remotePage && remotePage.deletedGroupIds) || {} }
    );

    pages[url] = {
      title: (localPage && localPage.title) || (remotePage && remotePage.title) || '',
      lastUpdated: (localTime >= remoteTime ? localPage && localPage.lastUpdated : remotePage && remotePage.lastUpdated) || '',
      highlights: merged.highlights,
      deletedGroupIds: merged.deletedGroupIds,
    };
  }

  const localSettingsAt = localBlob.settings.updatedAt || 0;
  const remoteSettingsAt = remoteBlob.settings.updatedAt || 0;
  const settings = remoteSettingsAt > localSettingsAt ? remoteBlob.settings : localBlob.settings;

  return {
    version: 1,
    updatedAt: Date.now(),
    settings,
    pages,
    deletedUrls,
  };
}

function isSameHighlightState(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function sortedEntries(obj) {
  const sorted = {};
  for (const key of Object.keys(obj || {}).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

function canonicalPage(page) {
  if (!page) return null;
  const highlights = [...(page.highlights || [])].sort((a, b) =>
    (a.groupId || '').localeCompare(b.groupId || '')
  );
  return {
    title: page.title || '',
    lastUpdated: page.lastUpdated || '',
    highlights,
    deletedGroupIds: sortedEntries(page.deletedGroupIds),
  };
}

/**
 * Order-insensitive comparison of the syncable content of two blobs. Ignores
 * the top-level `updatedAt` stamp (regenerated on every merge, carries no
 * signal about whether anything changed) and sorts pages/highlights/tombstone
 * maps before comparing, since mergeBlobs/mergeHighlights build those from
 * Map/Set iteration and spreads whose key order depends on which side
 * (local vs remote) happened to be processed first.
 */
export function isBlobContentEqual(a, b) {
  const canonicalize = (blob) => {
    const pages = {};
    for (const url of Object.keys(blob.pages || {}).sort()) {
      pages[url] = canonicalPage(blob.pages[url]);
    }
    return JSON.stringify({
      settings: blob.settings,
      pages,
      deletedUrls: sortedEntries(blob.deletedUrls),
    });
  };
  return canonicalize(a) === canonicalize(b);
}

async function applyMergedPagesToLocal(mergedPages, deletedUrls, localPagesBefore) {
  const saveData = {};
  for (const [url, page] of Object.entries(mergedPages)) {
    saveData[url] = page.highlights;
    saveData[`${url}${STORAGE_KEYS.META_SUFFIX}`] = {
      title: page.title,
      lastUpdated: page.lastUpdated,
      deletedGroupIds: page.deletedGroupIds,
    };
  }
  if (Object.keys(saveData).length > 0) {
    await browserAPI.storage.local.set(saveData);
  }

  const removeKeys = [];
  const removedUrls = [];
  for (const url of Object.keys(localPagesBefore)) {
    if (!mergedPages[url] && deletedUrls[url]) {
      removeKeys.push(url, `${url}${STORAGE_KEYS.META_SUFFIX}`);
      removedUrls.push(url);
    }
  }
  if (removeKeys.length > 0) {
    await browserAPI.storage.local.remove(removeKeys);
  }

  return { removedUrls };
}

async function broadcastMergedPages(mergedPages, localPagesBefore, removedUrls) {
  for (const [url, page] of Object.entries(mergedPages)) {
    const before = localPagesBefore[url];
    if (!before || !isSameHighlightState(before.highlights, page.highlights)) {
      await broadcastToTabsByUrl(url, { action: 'refreshHighlights', highlights: page.highlights });
    }
  }
  for (const url of removedUrls) {
    await broadcastToTabsByUrl(url, { action: 'refreshHighlights', highlights: [] });
  }
}

async function fetchRemoteBlob(keyId, encryptionKey, { allowMissingRemote = true } = {}) {
  const res = await fetch(`${CLOUD_SYNC_ENDPOINT_BASE}/blob/${keyId}`);
  if (res.status === 404) {
    if (allowMissingRemote) return emptyBlob();
    throw new Error('Cloud sync data not found (sync code may be incorrect)');
  }
  if (!res.ok) throw new Error(`Failed to fetch cloud data (${res.status})`);

  const envelope = await res.json();
  try {
    return await decryptBlob(envelope, encryptionKey);
  } catch (e) {
    throw new Error('Failed to decrypt cloud data (sync code may be incorrect)');
  }
}

async function pushRemoteBlob(keyId, encryptionKey, blob) {
  const envelope = await encryptBlob(blob, encryptionKey);
  const body = JSON.stringify(envelope);
  const bodyBytes = byteLength(body);
  if (bodyBytes > CLOUD_SYNC_MAX_BODY_BYTES) {
    throw createCloudSyncSizeError(bodyBytes, CLOUD_SYNC_MAX_BODY_BYTES);
  }

  const res = await fetch(`${CLOUD_SYNC_ENDPOINT_BASE}/blob/${keyId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`Failed to push cloud data (${res.status})`);
}

export async function getCloudSyncStatus() {
  const result = await browserAPI.storage.local.get([
    CLOUD_SYNC_KEYS.ENABLED,
    CLOUD_SYNC_KEYS.CODE,
    CLOUD_SYNC_KEYS.LAST_SYNCED_AT,
    CLOUD_SYNC_KEYS.LAST_ERROR,
    CLOUD_SYNC_KEYS.LAST_ERROR_DETAILS,
  ]);

  return {
    enabled: !!result[CLOUD_SYNC_KEYS.ENABLED],
    code: result[CLOUD_SYNC_KEYS.CODE] || null,
    lastSyncedAt: result[CLOUD_SYNC_KEYS.LAST_SYNCED_AT] || null,
    lastError: result[CLOUD_SYNC_KEYS.LAST_ERROR] || null,
    lastErrorDetails: result[CLOUD_SYNC_KEYS.LAST_ERROR_DETAILS] || null,
  };
}

/**
 * Pull-merge-push cycle. Safe to call repeatedly (alarm, manual button, startup).
 * No-ops if cloud sync isn't enabled.
 */
export async function runCloudSync({ allowMissingRemote = true, forcePush = false } = {}) {
  const status = await getCloudSyncStatus();
  if (!status.enabled || !status.code) {
    return { success: false, error: 'Cloud sync is not enabled' };
  }

  try {
    const { encryptionKey, keyId } = await deriveSyncKeys(status.code);
    const localBlob = await buildLocalBlob();
    const remoteBlob = await fetchRemoteBlob(keyId, encryptionKey, { allowMissingRemote });
    const merged = mergeBlobs(localBlob, remoteBlob);

    const { removedUrls } = await applyMergedPagesToLocal(merged.pages, merged.deletedUrls, localBlob.pages);
    await broadcastMergedPages(merged.pages, localBlob.pages, removedUrls);

    if (merged.settings !== localBlob.settings) {
      const { colorsChanged } = await applySettingsFromSync(merged.settings);
      await browserAPI.storage.local.set({ [CLOUD_SYNC_KEYS.SETTINGS_UPDATED_AT]: merged.settings.updatedAt || 0 });
      if (colorsChanged) await createOrUpdateContextMenus();
    }

    await browserAPI.storage.local.set({ [CLOUD_SYNC_KEYS.DELETED_URLS]: merged.deletedUrls });

    if (!forcePush && isBlobContentEqual(merged, remoteBlob)) {
      debugLog('Cloud sync: no changes since last push, skipping PUT.');
    } else {
      await pushRemoteBlob(keyId, encryptionKey, merged);
    }

    await browserAPI.storage.local.set({
      [CLOUD_SYNC_KEYS.LAST_SYNCED_AT]: Date.now(),
      [CLOUD_SYNC_KEYS.LAST_ERROR]: null,
      [CLOUD_SYNC_KEYS.LAST_ERROR_DETAILS]: null,
    });
    debugLog('Cloud sync completed.');
    return { success: true };
  } catch (e) {
    debugLog('Cloud sync failed:', e.message);
    const errorDetails = getErrorDetails(e);
    await browserAPI.storage.local.set({
      [CLOUD_SYNC_KEYS.LAST_ERROR]: e.message,
      [CLOUD_SYNC_KEYS.LAST_ERROR_DETAILS]: errorDetails,
    });
    return { success: false, error: e.message, errorDetails };
  }
}

/**
 * Generate a brand-new sync code and enable cloud sync on this device.
 * The caller (settings UI) is responsible for showing/copy the code so it can
 * be entered on other devices — it is never sent anywhere.
 */
export async function enableCloudSyncWithNewCode() {
  const code = generateSyncCode();
  await browserAPI.storage.local.set({
    [CLOUD_SYNC_KEYS.ENABLED]: true,
    [CLOUD_SYNC_KEYS.CODE]: code,
  });
  const result = await runCloudSync({ forcePush: true });
  return { code, ...result };
}

/**
 * Enable cloud sync using a code generated on another device.
 */
export async function enableCloudSyncWithExistingCode(code) {
  const trimmed = (code || '').trim();
  try {
    const { encryptionKey, keyId } = await deriveSyncKeys(trimmed);
    await fetchRemoteBlob(keyId, encryptionKey, { allowMissingRemote: false });
  } catch (e) {
    return { success: false, error: e.message || 'Invalid sync code' };
  }

  await browserAPI.storage.local.set({
    [CLOUD_SYNC_KEYS.ENABLED]: true,
    [CLOUD_SYNC_KEYS.CODE]: trimmed,
  });
  return await runCloudSync();
}

/**
 * Disable cloud sync on this device. The sync code is kept locally so re-enabling
 * doesn't require re-entering it; use resetCloudSyncCode to forget it entirely.
 */
export async function disableCloudSync() {
  await browserAPI.storage.local.set({ [CLOUD_SYNC_KEYS.ENABLED]: false });
}

export async function resetCloudSyncCode() {
  await browserAPI.storage.local.set({
    [CLOUD_SYNC_KEYS.ENABLED]: false,
    [CLOUD_SYNC_KEYS.CODE]: null,
    [CLOUD_SYNC_KEYS.LAST_SYNCED_AT]: null,
    [CLOUD_SYNC_KEYS.LAST_ERROR]: null,
    [CLOUD_SYNC_KEYS.LAST_ERROR_DETAILS]: null,
  });
}

/**
 * Register the periodic alarm that drives batched cloud sync. Call once at
 * service worker startup (top-level), alongside initSyncListener.
 */
export function initCloudSyncAlarm() {
  if (!browserAPI.alarms) return;

  browserAPI.alarms.create(CLOUD_SYNC_ALARM_NAME, { periodInMinutes: CLOUD_SYNC_ALARM_PERIOD_MINUTES });
  browserAPI.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== CLOUD_SYNC_ALARM_NAME) return;
    runCloudSync().catch(e => debugLog('Cloud sync alarm run failed:', e.message));
  });
}
