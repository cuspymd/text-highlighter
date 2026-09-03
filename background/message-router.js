import { browserAPI } from '../shared/browser-api.js';
import { DEBUG_MODE, debugLog } from '../shared/logger.js';
import { broadcastToAllTabs, broadcastToTabsByUrl } from '../shared/tab-broadcast.js';
import { STORAGE_KEYS } from '../constants/storage-keys.js';
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
  createOrUpdateContextMenus,
  updateCustomColor,
  updateCustomColorName,
  removeCustomColor,
  getShortcutColorMap,
  saveShortcutColorMap,
  ensureCustomColorsLoaded,
} from './settings-service.js';

function successResponse(data = {}) { return { success: true, ...data }; }
function errorResponse(message) { return { success: false, error: message }; }

// ===================================================================
// Action handlers
// ===================================================================

async function handleGetDebugMode(_message) {
  return { debugMode: DEBUG_MODE };
}

async function handleGetPlatformInfo(_message) {
  return getPlatformInfo();
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

  const keys = Object.keys(settings);
  if (keys.length === 0) return successResponse();

  const previous = await browserAPI.storage.local.get(keys);
  const changedSettings = {};
  for (const key of keys) {
    if (previous[key] !== settings[key]) changedSettings[key] = settings[key];
  }

  await browserAPI.storage.local.set(settings);
  await broadcastSettingsToTabs(changedSettings);

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
  if (!hadColors) return successResponse({ noCustomColors: true });

  await createOrUpdateContextMenus();
  await broadcastToAllTabs({ action: 'colorsUpdated', colors });
  return successResponse();
}

async function handleAddColor(message) {
  if (!message.color) return errorResponse('No color value provided');

  const { exists, colors } = await addCustomColor(message.color);
  if (!exists) {
    await createOrUpdateContextMenus();
    await broadcastToAllTabs({ action: 'colorsUpdated', colors });
  }
  return successResponse({ exists, colors });
}

async function handleUpdateCustomColor(message) {
  if (!message.id || !message.color) return errorResponse('Missing id or color');
  const result = await updateCustomColor(message.id, message.color);
  if (result.notFound) return errorResponse('Color not found');
  if (result.exists) return successResponse({ exists: true, colors: result.colors });
  await createOrUpdateContextMenus();
  await broadcastToAllTabs({ action: 'colorsUpdated', colors: result.colors });
  return successResponse({ colors: result.colors });
}

async function handleUpdateCustomColorName(message) {
  if (!message.id || !message.name) return errorResponse('Missing id or name');
  await ensureCustomColorsLoaded();
  const result = await updateCustomColorName(message.id, message.name);
  if (result.notFound) return errorResponse('Color not found');
  if (result.exists) return successResponse({ exists: true, colors: result.colors });
  await createOrUpdateContextMenus();
  await broadcastToAllTabs({ action: 'colorsUpdated', colors: result.colors });
  return successResponse({ colors: result.colors });
}

async function handleRemoveCustomColor(message) {
  if (!message.id) return errorResponse('Missing id');
  const result = await removeCustomColor(message.id);
  if (result.notFound) return errorResponse('Color not found');
  await createOrUpdateContextMenus();
  await broadcastToAllTabs({ action: 'colorsUpdated', colors: result.colors });
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
    const saveData = {};
    saveData[message.url] = message.highlights;
    await browserAPI.storage.local.set(saveData);
    debugLog('Saved highlights for URL:', message.url, message.highlights);

    const result = await browserAPI.storage.local.get([`${message.url}${STORAGE_KEYS.META_SUFFIX}`]);
    const metaData = result[`${message.url}${STORAGE_KEYS.META_SUFFIX}`] || {};
    if (sender && sender.tab) metaData.title = sender.tab.title;

    // Groups this save merged away. Their tombstones land in the same write as
    // the list without them, so a sync cannot bring them back and no separate
    // delete can race this save for the page's list.
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

    const metaSaveData = {};
    metaSaveData[`${message.url}${STORAGE_KEYS.META_SUFFIX}`] = metaData;
    await browserAPI.storage.local.set(metaSaveData);
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

  const skipKeys = new Set([
    STORAGE_KEYS.CUSTOM_COLORS,
    STORAGE_KEYS.SYNC_MIGRATION_DONE,
    STORAGE_KEYS.MINIMAP_VISIBLE,
    STORAGE_KEYS.SELECTION_CONTROLS_VISIBLE,
    STORAGE_KEYS.SHORTCUT_COLOR_MAP,
  ]);

  for (const key in result) {
    if (skipKeys.has(key)) continue;
    if (Array.isArray(result[key]) && result[key].length > 0 && !key.endsWith(STORAGE_KEYS.META_SUFFIX)) {
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

  const skipKeys = new Set([
    STORAGE_KEYS.CUSTOM_COLORS,
    STORAGE_KEYS.SYNC_MIGRATION_DONE,
    STORAGE_KEYS.MINIMAP_VISIBLE,
    STORAGE_KEYS.SELECTION_CONTROLS_VISIBLE,
    STORAGE_KEYS.SHORTCUT_COLOR_MAP,
  ]);

  for (const key in result) {
    if (skipKeys.has(key)) continue;
    if (Array.isArray(result[key]) && result[key].length > 0 && !key.endsWith(STORAGE_KEYS.META_SUFFIX)) {
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
  getDebugMode:              handleGetDebugMode,
  getPlatformInfo:           handleGetPlatformInfo,
  getColors:                 handleGetColors,
  saveSettings:              handleSaveSettings,
  getHighlights:             handleGetHighlights,
  clearCustomColors:         handleClearCustomColors,
  addColor:                  handleAddColor,
  updateCustomColor:         handleUpdateCustomColor,
  updateCustomColorName:     handleUpdateCustomColorName,
  removeCustomColor:         handleRemoveCustomColor,
  getShortcutColorMap:       handleGetShortcutColorMap,
  saveShortcutColorMap:      handleSaveShortcutColorMap,
  saveHighlights:            handleSaveHighlights,
  deleteHighlight:           handleDeleteHighlight,
  clearAllHighlights:        handleClearAllHighlights,
  getAllHighlightedPages:    handleGetAllHighlightedPages,
  deleteAllHighlightedPages: handleDeleteAllHighlightedPages,
  getCloudSyncStatus:        handleGetCloudSyncStatus,
  enableCloudSync:           handleEnableCloudSync,
  pairCloudSync:             handlePairCloudSync,
  disableCloudSync:          handleDisableCloudSync,
  resetCloudSyncCode:        handleResetCloudSyncCode,
  triggerCloudSync:          handleTriggerCloudSync,
};

/**
 * Register the runtime.onMessage listener.
 * Call once at service worker startup (top-level, before any async code).
 */
export function registerMessageRouter() {
  browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
