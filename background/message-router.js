import { browserAPI } from '../shared/browser-api.js';
import { debugLog } from '../shared/logger.js';
import { broadcastToTabsByUrl } from '../shared/tab-broadcast.js';
import { STORAGE_KEYS, CLOUD_SYNC_KEYS, isPageKey } from '../constants/storage-keys.js';
import {
  syncSaveHighlights,
  syncRemoveHighlights,
  clearAllSyncedHighlights,
  cleanupEmptyHighlightData,
  cleanupTombstones,
  saveSettingsToSync,
  recordCloudSyncTombstones,
} from './sync-service.js';
import {
  getCloudSyncStatus,
  enableCloudSyncWithNewCode,
  enableCloudSyncWithExistingCode,
  disableCloudSync,
  resetCloudSyncCode,
  runCloudSync,
} from './cloud-sync-service.js';
import {
  getPlatformInfo,
  getCurrentColors,
  addCustomColor,
  clearCustomColors,
  broadcastSettingsToTabs,
  setHideDefaultColors,
  createOrUpdateContextMenus,
  updateCustomColor,
  updateCustomColorName,
  removeCustomColor,
  reorderCustomColors,
  getShortcutColorMap,
  saveShortcutColorMap,
  ensureCustomColorsLoaded,
} from './settings-service.js';
import { openExtensionPage } from './extension-pages.js';

function successResponse(data = {}) { return { success: true, ...data }; }
function errorResponse(message) { return { success: false, error: message }; }

// ===================================================================
// Action handlers
// ===================================================================

async function handleGetPlatformInfo(_message) {
  return getPlatformInfo();
}

async function handleOpenExtensionPage(message) {
  return openExtensionPage(message.page);
}

async function handleGetColors(_message) {
  await ensureCustomColorsLoaded();
  debugLog('Content script requested COLORS.');
  return { colors: getCurrentColors() };
}

async function handleSaveSettings(message) {
  const settings = {};
  if (message.minimapVisible !== undefined) settings.minimapVisible = message.minimapVisible;
  if (message.selectionControlsVisible !== undefined) settings.selectionControlsVisible = message.selectionControlsVisible;
  if (message.oneClickHighlightEnabled !== undefined) settings.oneClickHighlightEnabled = message.oneClickHighlightEnabled;
  if (message.hideDefaultColors !== undefined) settings.hideDefaultColors = message.hideDefaultColors;

  const keys = Object.keys(settings);
  if (keys.length === 0) return successResponse();

  const previous = await browserAPI.storage.local.get(keys);
  const changedSettings = {};
  for (const key of keys) {
    if (previous[key] !== settings[key]) changedSettings[key] = settings[key];
  }

  await browserAPI.storage.local.set(settings);
  await broadcastSettingsToTabs(changedSettings);

  if (changedSettings.hideDefaultColors !== undefined) {
    setHideDefaultColors(changedSettings.hideDefaultColors);
    await createOrUpdateContextMenus();
  }

  saveSettingsToSync().catch(e => {
    debugLog('Failed to save settings to sync (local already applied):', e.message);
  });

  debugLog('Settings saved locally and broadcasted:', settings, 'changed:', changedSettings);
  return successResponse();
}

async function handleGetHighlights(message) {
  const result = await browserAPI.storage.local.get([message.url]);
  debugLog('Sending highlights for URL:', message.url, result[message.url] || []);
  return { highlights: result[message.url] || [] };
}

async function handleClearCustomColors(_message) {
  const { hadColors, colors } = await clearCustomColors();
  if (!hadColors) return successResponse({ noCustomColors: true, colors });
  return successResponse({ colors });
}

async function handleAddColor(message) {
  if (!message.color) return errorResponse('No color value provided');

  const { exists, colors } = await addCustomColor(message.color);
  return successResponse({ exists, colors });
}

async function handleUpdateCustomColor(message) {
  if (!message.id || !message.color) return errorResponse('Missing id or color');
  const result = await updateCustomColor(message.id, message.color);
  if (result.notFound) return errorResponse('Color not found');
  if (result.exists) return successResponse({ exists: true, colors: result.colors });
  return successResponse({ colors: result.colors });
}

async function handleUpdateCustomColorName(message) {
  if (!message.id || !message.name) return errorResponse('Missing id or name');
  await ensureCustomColorsLoaded();
  const result = await updateCustomColorName(message.id, message.name);
  if (result.notFound) return errorResponse('Color not found');
  if (result.exists) return successResponse({ exists: true, colors: result.colors });
  return successResponse({ colors: result.colors });
}

async function handleRemoveCustomColor(message) {
  if (!message.id) return errorResponse('Missing id');
  const result = await removeCustomColor(message.id);
  if (result.notFound) return errorResponse('Color not found');
  return successResponse({ colors: result.colors });
}

async function handleReorderCustomColors(message) {
  if (!Array.isArray(message.ids)) return errorResponse('Missing ids');
  const result = await reorderCustomColors(message.ids);
  if (result.mismatch) return successResponse({ mismatch: true, colors: result.colors });
  return successResponse({ colors: result.colors });
}

async function handleGetShortcutColorMap(_message) {
  await ensureCustomColorsLoaded();
  return successResponse({ shortcutColorMap: getShortcutColorMap() });
}

async function handleSaveShortcutColorMap(message) {
  if (!message.shortcutColorMap) return errorResponse('Missing shortcutColorMap');
  await saveShortcutColorMap(message.shortcutColorMap);
  await createOrUpdateContextMenus();
  return successResponse();
}

async function handleSaveHighlights(message, sender) {
  if (message.highlights.length > 0) {
    const metaKey = `${message.url}${STORAGE_KEYS.META_SUFFIX}`;
    const result = await browserAPI.storage.local.get([metaKey]);
    const metaData = result[metaKey] || {};
    if (sender && sender.tab) metaData.title = sender.tab.title;

    // Groups this save merged away. Their tombstones go into the same
    // storage.local.set as the list without them: a save from another tab on
    // this url that lands between two separate writes would read the new list
    // with the old metadata and write the tombstones away again, and a sync
    // could then bring the merged groups back.
    if (Array.isArray(message.deletedGroupIds) && message.deletedGroupIds.length > 0) {
      const deletedGroupIds = metaData.deletedGroupIds || {};
      const deletedAt = Date.now();
      message.deletedGroupIds.forEach(groupId => {
        deletedGroupIds[groupId] = deletedAt;
      });
      cleanupTombstones(deletedGroupIds);
      metaData.deletedGroupIds = deletedGroupIds;
    }
    metaData.lastUpdated = new Date().toISOString();

    await browserAPI.storage.local.set({
      [message.url]: message.highlights,
      [metaKey]: metaData,
    });
    debugLog('Saved highlights for URL:', message.url, message.highlights);
    debugLog('Saved page metadata:', metaData);

    await syncSaveHighlights(message.url, message.highlights, metaData.title, metaData.lastUpdated);
    return successResponse();
  } else {
    const tombstoneRecorded = await syncRemoveHighlights(message.url);
    await cleanupEmptyHighlightData(message.url);
    if (!tombstoneRecorded) await recordCloudSyncTombstones([message.url]);
    return successResponse();
  }
}

// The tab that asked for the delete has already taken the group off its page,
// so it is left out of the refresh. A refresh there would replace the whole
// page with the storage state as of this delete - and a highlight the user made
// in the meantime is in that tab and in the save behind this one, but not in
// that state, so it would vanish until the next reload.
async function handleDeleteHighlight(message, sender) {
  const { url, groupId } = message;
  const excludeTabId = sender && sender.tab ? sender.tab.id : undefined;
  const result = await browserAPI.storage.local.get([url, `${url}${STORAGE_KEYS.META_SUFFIX}`]);
  const highlights = result[url] || [];
  const meta = result[`${url}${STORAGE_KEYS.META_SUFFIX}`] || {};

  const deletedGroupIds = meta.deletedGroupIds || {};
  deletedGroupIds[groupId] = Date.now();
  cleanupTombstones(deletedGroupIds);

  const updatedHighlights = highlights.filter(g => g.groupId !== groupId);

  if (updatedHighlights.length > 0) {
    const lastUpdated = new Date().toISOString();
    const saveData = {};
    saveData[url] = updatedHighlights;
    saveData[`${url}${STORAGE_KEYS.META_SUFFIX}`] = { ...meta, deletedGroupIds, lastUpdated };
    await browserAPI.storage.local.set(saveData);
    debugLog('Highlight group deleted:', groupId, 'from URL:', url);

    await syncSaveHighlights(url, updatedHighlights, meta.title || '', lastUpdated);

    if (message.notifyRefresh) {
      await broadcastToTabsByUrl(url, { action: 'refreshHighlights', highlights: updatedHighlights }, { excludeTabId });
    }
    return successResponse({ highlights: updatedHighlights });
  } else {
    const tombstoneRecorded = await syncRemoveHighlights(url);
    await cleanupEmptyHighlightData(url);
    if (!tombstoneRecorded) await recordCloudSyncTombstones([url]);
    if (message.notifyRefresh) {
      await broadcastToTabsByUrl(url, { action: 'refreshHighlights', highlights: [] }, { excludeTabId });
    }
    return successResponse({ highlights: [] });
  }
}

async function handleClearAllHighlights(message) {
  const { url } = message;
  const tombstoneRecorded = await syncRemoveHighlights(url);
  await cleanupEmptyHighlightData(url);
  if (!tombstoneRecorded) await recordCloudSyncTombstones([url]);
  if (message.notifyRefresh) {
    await broadcastToTabsByUrl(url, { action: 'refreshHighlights', highlights: [] });
  }
  return successResponse();
}

async function handleGetAllHighlightedPages(_message) {
  const result = await browserAPI.storage.local.get(null);
  const pages = [];

  for (const key in result) {
    if (isPageKey(key, result[key]) && result[key].length > 0) {
      const url = key;
      const metadata = result[`${url}${STORAGE_KEYS.META_SUFFIX}`] || {};
      pages.push({
        url,
        highlights: result[url],
        highlightCount: result[url].length,
        title: metadata.title || '',
        lastUpdated: metadata.lastUpdated || '',
      });
    }
  }

  debugLog('Retrieved all highlighted pages:', pages);

  pages.sort((a, b) => {
    if (!a.lastUpdated) return 1;
    if (!b.lastUpdated) return -1;
    return new Date(b.lastUpdated) - new Date(a.lastUpdated);
  });

  return successResponse({ pages });
}

async function handleDeleteAllHighlightedPages(_message) {
  const result = await browserAPI.storage.local.get(null);
  const keysToDelete = [];
  const urls = [];

  for (const key in result) {
    if (isPageKey(key, result[key]) && result[key].length > 0) {
      keysToDelete.push(key, `${key}${STORAGE_KEYS.META_SUFFIX}`);
      urls.push(key);
    }
  }

  if (keysToDelete.length > 0) {
    const tombstoneRecorded = await clearAllSyncedHighlights(urls);
    await browserAPI.storage.local.remove(keysToDelete);
    debugLog('All highlighted pages deleted:', keysToDelete);
    if (!tombstoneRecorded) await recordCloudSyncTombstones(urls);
  }

  return successResponse({ deletedCount: keysToDelete.length / 2 });
}

/**
 * Write pages from an export file, replacing what is stored for those urls.
 *
 * An import is a fresh edit made now, not a replay of the file's past, so every
 * page and group is stamped with the import time. The file's own timestamps
 * predate any deletion made since the backup, and every merge - storage.sync,
 * the cloud blob - lets a deletion win over anything older: the page would be
 * deleted again by the next cloud sync, and its groups filtered out again.
 *
 * Groups that were stored for a url but are not in the file get a tombstone,
 * so the copies still in storage.sync and the cloud do not merge them back in:
 * the user was told they would be replaced.
 *
 * All pages go into one storage.local.set, together with the url tombstones
 * they clear, so a cloud sync that runs alongside sees either none of the
 * import or all of it.
 */
async function handleImportPages(message) {
  if (!Array.isArray(message.pages)) return errorResponse('Missing pages');
  // A file that lists a url twice keeps only its last entry, as a single
  // storage write would. Syncing every entry would merge the earlier one's
  // groups back into the later one.
  const byUrl = new Map();
  message.pages.forEach(page => {
    if (page && typeof page.url === 'string' && page.url
      && Array.isArray(page.highlights) && page.highlights.length > 0) {
      byUrl.delete(page.url);
      byUrl.set(page.url, page);
    }
  });
  const pages = [...byUrl.values()];
  if (pages.length === 0) return successResponse({ importedCount: 0 });

  const metaKey = url => `${url}${STORAGE_KEYS.META_SUFFIX}`;
  const stored = await browserAPI.storage.local.get([
    ...pages.flatMap(page => [page.url, metaKey(page.url)]),
    CLOUD_SYNC_KEYS.DELETED_URLS,
  ]);

  const now = Date.now();
  const lastUpdated = new Date(now).toISOString();
  const deletedUrls = { ...(stored[CLOUD_SYNC_KEYS.DELETED_URLS] || {}) };
  const saveData = {};
  const written = [];

  for (const page of pages) {
    const highlights = page.highlights.map(group => ({ ...group, updatedAt: now }));
    const importedIds = new Set(highlights.map(group => group.groupId));
    const meta = stored[metaKey(page.url)] || {};

    const deletedGroupIds = { ...(meta.deletedGroupIds || {}) };
    (stored[page.url] || []).forEach(group => {
      if (!importedIds.has(group.groupId)) deletedGroupIds[group.groupId] = now;
    });
    importedIds.forEach(groupId => { delete deletedGroupIds[groupId]; });
    cleanupTombstones(deletedGroupIds);

    const title = page.title || meta.title || '';
    saveData[page.url] = highlights;
    saveData[metaKey(page.url)] = { ...meta, title, lastUpdated, deletedGroupIds };
    delete deletedUrls[page.url];
    written.push({ url: page.url, highlights, title });
  }
  saveData[CLOUD_SYNC_KEYS.DELETED_URLS] = deletedUrls;

  await browserAPI.storage.local.set(saveData);
  debugLog('Imported pages:', written.map(page => page.url));

  // One page at a time: each call works out the room left in storage.sync
  // from what is there, so calls running side by side would each count
  // without the others and overshoot the quota together.
  for (const page of written) {
    await syncSaveHighlights(page.url, page.highlights, page.title, lastUpdated);
  }

  // A tab already open on an imported url still holds the old list, and its
  // next save would write that list back over the import.
  const after = await browserAPI.storage.local.get(written.map(page => page.url));
  for (const page of written) {
    await broadcastToTabsByUrl(page.url, {
      action: 'refreshHighlights',
      highlights: after[page.url] || page.highlights,
    });
  }

  return successResponse({ importedCount: written.length });
}

async function handleGetCloudSyncStatus(_message) {
  return successResponse(await getCloudSyncStatus());
}

async function handleEnableCloudSync(_message) {
  const result = await enableCloudSyncWithNewCode();
  return successResponse(result);
}

async function handlePairCloudSync(message) {
  if (!message.code) return errorResponse('Missing sync code');
  const result = await enableCloudSyncWithExistingCode(message.code);
  return result.success ? successResponse(result) : errorResponse(result.error);
}

async function handleDisableCloudSync(_message) {
  await disableCloudSync();
  return successResponse();
}

async function handleResetCloudSyncCode(_message) {
  await resetCloudSyncCode();
  return successResponse();
}

async function handleTriggerCloudSync(_message) {
  const result = await runCloudSync();
  return result.success ? successResponse(result) : errorResponse(result.error);
}

// ===================================================================
// Action handler map
// ===================================================================

const ACTION_HANDLERS = {
  getPlatformInfo:           handleGetPlatformInfo,
  openExtensionPage:         handleOpenExtensionPage,
  getColors:                 handleGetColors,
  saveSettings:              handleSaveSettings,
  getHighlights:             handleGetHighlights,
  clearCustomColors:         handleClearCustomColors,
  addColor:                  handleAddColor,
  updateCustomColor:         handleUpdateCustomColor,
  updateCustomColorName:     handleUpdateCustomColorName,
  removeCustomColor:         handleRemoveCustomColor,
  reorderCustomColors:       handleReorderCustomColors,
  getShortcutColorMap:       handleGetShortcutColorMap,
  saveShortcutColorMap:      handleSaveShortcutColorMap,
  saveHighlights:            handleSaveHighlights,
  deleteHighlight:           handleDeleteHighlight,
  clearAllHighlights:        handleClearAllHighlights,
  getAllHighlightedPages:    handleGetAllHighlightedPages,
  deleteAllHighlightedPages: handleDeleteAllHighlightedPages,
  importPages:               handleImportPages,
  getCloudSyncStatus:        handleGetCloudSyncStatus,
  enableCloudSync:           handleEnableCloudSync,
  pairCloudSync:             handlePairCloudSync,
  disableCloudSync:          handleDisableCloudSync,
  resetCloudSyncCode:        handleResetCloudSyncCode,
  triggerCloudSync:          handleTriggerCloudSync,
};

// Messages one extension page sends to another. runtime.sendMessage reaches the
// background too, and an error reply from here could answer the sender before
// the page it was meant for does, so the router leaves them unanswered.
const PAGE_TO_PAGE_ACTIONS = new Set([
  'refreshPagesList',
]);

/**
 * Register the runtime.onMessage listener.
 * Call once at service worker startup (top-level, before any async code).
 */
export function registerMessageRouter() {
  browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (PAGE_TO_PAGE_ACTIONS.has(message.action)) return false;

    const handler = ACTION_HANDLERS[message.action];
    if (!handler) {
      sendResponse(errorResponse(`Unknown action: ${message.action}`));
      return true;
    }

    handler(message, sender)
      .then(result => sendResponse(result))
      .catch(e => {
        debugLog('Error in message handler:', e);
        sendResponse(errorResponse(e.message));
      });

    return true; // Keep message channel open for async response
  });
}
