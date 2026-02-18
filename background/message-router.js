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
} from './sync-service.js';
import {
  getPlatformInfo,
  getCurrentColors,
  addCustomColor,
  clearCustomColors,
  broadcastSettingsToTabs,
  createOrUpdateContextMenus,
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
  return successResponse({ colors });
}

async function handleSaveHighlights(message) {
  const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];

  if (message.highlights.length > 0) {
    const saveData = {};
    saveData[message.url] = message.highlights;
    await browserAPI.storage.local.set(saveData);
    debugLog('Saved highlights for URL:', message.url, message.highlights);

    const result = await browserAPI.storage.local.get([`${message.url}${STORAGE_KEYS.META_SUFFIX}`]);
    const metaData = result[`${message.url}${STORAGE_KEYS.META_SUFFIX}`] || {};
    metaData.title = currentTab.title;
    metaData.lastUpdated = new Date().toISOString();

    const metaSaveData = {};
    metaSaveData[`${message.url}${STORAGE_KEYS.META_SUFFIX}`] = metaData;
    await browserAPI.storage.local.set(metaSaveData);
    debugLog('Saved page metadata:', metaData);

    await syncSaveHighlights(message.url, message.highlights, metaData.title, metaData.lastUpdated);
    return successResponse();
  } else {
    await cleanupEmptyHighlightData(message.url);
    await syncRemoveHighlights(message.url);
    return successResponse();
  }
}

async function handleDeleteHighlight(message) {
  const { url, groupId } = message;
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
      await broadcastToTabsByUrl(url, { action: 'refreshHighlights', highlights: updatedHighlights });
    }
    return successResponse({ highlights: updatedHighlights });
  } else {
    await cleanupEmptyHighlightData(url);
    await syncRemoveHighlights(url);
    if (message.notifyRefresh) {
      await broadcastToTabsByUrl(url, { action: 'refreshHighlights', highlights: [] });
    }
    return successResponse({ highlights: [] });
  }
}

async function handleClearAllHighlights(message) {
  const { url } = message;
  await cleanupEmptyHighlightData(url);
  await syncRemoveHighlights(url);
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
  const urlsToDelete = [];

  const skipKeys = new Set([
    STORAGE_KEYS.CUSTOM_COLORS,
    STORAGE_KEYS.SYNC_MIGRATION_DONE,
    STORAGE_KEYS.MINIMAP_VISIBLE,
    STORAGE_KEYS.SELECTION_CONTROLS_VISIBLE,
  ]);

  for (const key in result) {
    if (skipKeys.has(key)) continue;
    if (Array.isArray(result[key]) && result[key].length > 0 && !key.endsWith(STORAGE_KEYS.META_SUFFIX)) {
      keysToDelete.push(key, `${key}${STORAGE_KEYS.META_SUFFIX}`);
      urlsToDelete.push(key);
    }
  }

  if (keysToDelete.length > 0) {
    await browserAPI.storage.local.remove(keysToDelete);
    debugLog('All highlighted pages deleted:', keysToDelete);
    await clearAllSyncedHighlights(urlsToDelete);
  }

  return successResponse({ deletedCount: keysToDelete.length / 2 });
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
  saveHighlights:            handleSaveHighlights,
  deleteHighlight:           handleDeleteHighlight,
  clearAllHighlights:        handleClearAllHighlights,
  getAllHighlightedPages:     handleGetAllHighlightedPages,
  deleteAllHighlightedPages: handleDeleteAllHighlightedPages,
};

/**
 * Register the runtime.onMessage listener.
 * Call once at service worker startup (top-level, before any async code).
 */
export function registerMessageRouter() {
  browserAPI.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handler = ACTION_HANDLERS[message.action];
    if (!handler) {
      sendResponse(errorResponse(`Unknown action: ${message.action}`));
      return true;
    }

    handler(message)
      .then(result => sendResponse(result))
      .catch(e => {
        debugLog('Error in message handler:', e);
        sendResponse(errorResponse(e.message));
      });

    return true; // Keep message channel open for async response
  });
}
