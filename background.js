const COLORS = [
  { id: 'yellow', nameKey: 'yellowColor', color: '#FFFF00' },
  { id: 'green', nameKey: 'greenColor', color: '#AAFFAA' },
  { id: 'blue', nameKey: 'blueColor', color: '#AAAAFF' },
  { id: 'pink', nameKey: 'pinkColor', color: '#FFAAFF' },
  { id: 'orange', nameKey: 'orangeColor', color: '#FFAA55' }
];

// Cross-browser compatibility - use chrome API in Chrome, browser API in Firefox
const browserAPI = (() => {
  if (typeof browser !== 'undefined') {
    return browser;
  }
  if (typeof chrome !== 'undefined') {
    return chrome;
  }
  throw new Error('Neither browser nor chrome API is available');
})();

function getMessage(key, substitutions = null) {
  return browserAPI.i18n.getMessage(key, substitutions);
}

// Debug mode setting - change to true during development
const DEBUG_MODE = false;

// Debug log function
const debugLog = DEBUG_MODE ? console.log.bind(console) : () => {};

// ===================================================================
// Storage Sync Utilities
// ===================================================================

const SYNC_SETTINGS_KEY = 'settings';
const SYNC_HIGHLIGHT_PREFIX = 'hl_';
const SYNC_META_KEY = 'sync_meta';
const SYNC_QUOTA_BYTES_PER_ITEM = 8192;
// Reserve space for settings and sync_meta
const SYNC_HIGHLIGHT_BUDGET = 90000;
// Keep tombstones for 30 days
const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SYNC_REMOVAL_RECHECK_DELAY_MS = 500;
const SYNC_REMOVAL_MAX_RETRIES = 3;
const pendingSyncRemovalResolutions = new Map();

/**
 * Clean up old tombstones from a metadata object.
 */
function cleanupTombstones(obj) {
  if (!obj) return;
  const now = Date.now();
  for (const key in obj) {
    if (now - obj[key] > TOMBSTONE_RETENTION_MS) {
      delete obj[key];
    }
  }
}

function normalizeSyncMeta(rawMeta) {
  const meta = rawMeta || {};
  if (!Array.isArray(meta.pages)) meta.pages = [];
  if (typeof meta.totalSize !== 'number') meta.totalSize = 0;
  if (!meta.deletedUrls || typeof meta.deletedUrls !== 'object') meta.deletedUrls = {};
  cleanupTombstones(meta.deletedUrls);
  return meta;
}

// Generate a short hash from a URL for use as sync storage key
function urlToSyncKey(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const ch = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return SYNC_HIGHLIGHT_PREFIX + Math.abs(hash).toString(36);
}

// Save settings (customColors, minimapVisible, selectionControlsVisible) to sync
async function saveSettingsToSync() {
  const result = await browserAPI.storage.local.get([
    'customColors', 'minimapVisible', 'selectionControlsVisible'
  ]);
  const settings = {
    customColors: result.customColors || [],
    minimapVisible: result.minimapVisible !== undefined ? result.minimapVisible : true,
    selectionControlsVisible: result.selectionControlsVisible !== undefined ? result.selectionControlsVisible : true
  };
  try {
    await browserAPI.storage.sync.set({ [SYNC_SETTINGS_KEY]: settings });
    debugLog('Settings saved to sync:', settings);
  } catch (e) {
    debugLog('Failed to save settings to sync:', e.message);
  }
}

// Save a page's highlights to sync storage with capacity management
async function syncSaveHighlights(url, highlights, title, lastUpdated) {
  const syncKey = urlToSyncKey(url);

  try {
    // 1. Fetch current sync data and local metadata for merging
    const [syncResult, localMetaResult] = await Promise.all([
      browserAPI.storage.sync.get(syncKey),
      browserAPI.storage.local.get(`${url}_meta`)
    ]);

    const remoteData = syncResult[syncKey] || {};
    const localMeta = localMetaResult[`${url}_meta`] || {};

    // 2. Perform merge to handle concurrent edits (Rule 4.1)
    const merged = mergeHighlights(
      { highlights, deletedGroupIds: localMeta.deletedGroupIds || {} },
      { highlights: remoteData.highlights || [], deletedGroupIds: remoteData.deletedGroupIds || {} }
    );

    const data = {
      url,
      title,
      lastUpdated,
      highlights: merged.highlights,
      deletedGroupIds: merged.deletedGroupIds
    };

    const dataStr = JSON.stringify({ [syncKey]: data });
    const dataSize = new TextEncoder().encode(dataStr).byteLength;

    // Skip sync if single item exceeds per-item quota (Rule S-11)
    if (dataSize > SYNC_QUOTA_BYTES_PER_ITEM) {
      debugLog('Highlight data exceeds 8KB per-item limit, sync skipped for:', url, `(${dataSize}B)`);
      return;
    }

    // 3. Update local storage with merged result to ensure consistency
    const localData = {};
    localData[url] = merged.highlights;
    localData[`${url}_meta`] = { ...localMeta, title, lastUpdated, deletedGroupIds: merged.deletedGroupIds };
    await browserAPI.storage.local.set(localData);

    // 4. Check budget and evict if needed (Rule S-10)
    const meta = await getSyncMeta();
    let totalSize = meta.totalSize || 0;

    // Cleanup old URL tombstones
    cleanupTombstones(meta.deletedUrls);

    // Remove from deletedUrls if we are re-syncing this URL
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

    // 5. Save to sync
    await browserAPI.storage.sync.set({ [syncKey]: data });

    // 6. Update sync metadata
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

// Remove a page's highlights from sync storage (User-initiated deletion)
async function syncRemoveHighlights(url) {
  const syncKey = urlToSyncKey(url);
  try {
    const meta = await getSyncMeta();
    const idx = meta.pages.findIndex(p => p.syncKey === syncKey);

    // 1. Track that this URL was explicitly deleted by the user (Rule 4.3)
    if (!meta.deletedUrls) meta.deletedUrls = {};
    meta.deletedUrls[url] = Date.now();

    // 2. Perform cleanup of old tombstones to stay under quota
    cleanupTombstones(meta.deletedUrls);

    if (idx >= 0) {
      meta.totalSize = (meta.totalSize || 0) - (meta.pages[idx].size || 0);
      meta.pages.splice(idx, 1);
    }

    // 3. Update metadata with tombstone FIRST to ensure other devices
    // recognize this as a deletion when they see the data key removed.
    await browserAPI.storage.sync.set({ [SYNC_META_KEY]: meta });

    // 4. Remove the actual highlight data from sync
    await browserAPI.storage.sync.remove(syncKey);

    debugLog('Removed highlights from sync and added tombstone for:', url);
  } catch (e) {
    debugLog('Failed to remove highlights from sync:', e.message);
  }
}

// Get sync metadata
async function getSyncMeta() {
  try {
    const result = await browserAPI.storage.sync.get(SYNC_META_KEY);
    return normalizeSyncMeta(result[SYNC_META_KEY]);
  } catch (e) {
    return normalizeSyncMeta();
  }
}

/**
 * Merges two sets of highlights and deleted markers based on timestamps.
 * Implements Conflict Resolution Rule 4.1.
 */
function mergeHighlights(localData, remoteData) {
  const localHighlights = localData.highlights || [];
  const remoteHighlights = remoteData.highlights || [];
  const localDeleted = localData.deletedGroupIds || {};
  const remoteDeleted = remoteData.deletedGroupIds || {};

  // 1. Merge deleted markers (Tombstones) - Union and Cleanup
  const mergedDeleted = { ...localDeleted, ...remoteDeleted };
  cleanupTombstones(mergedDeleted);

  // 2. Combine all highlight groups
  const allGroupsMap = new Map();

  // Process all groups from both sides
  [...localHighlights, ...remoteHighlights].forEach(group => {
    const existing = allGroupsMap.get(group.groupId);
    // Use updatedAt if available, otherwise fallback to 0 (Rule 4.1)
    const groupTime = group.updatedAt || 0;
    const existingTime = existing ? (existing.updatedAt || 0) : -1;

    // Favor newer version if same groupId exists
    if (!existing || (groupTime > existingTime)) {
      allGroupsMap.set(group.groupId, group);
    }
  });

  // 3. Filter out deleted highlights
  // A highlight is considered deleted if it's in the mergedDeleted list
  // UNLESS it was updated AFTER it was deleted.
  const finalHighlights = Array.from(allGroupsMap.values()).filter(group => {
    const deletedAt = mergedDeleted[group.groupId];
    const groupTime = group.updatedAt || 0;
    return !deletedAt || (groupTime > deletedAt);
  });

  return {
    highlights: finalHighlights,
    deletedGroupIds: mergedDeleted
  };
}

/**
 * Initial synchronization on first run or fresh install.
 * Merges existing local data with sync storage and ensures consistency.
 * Satisfies Rule S-9 and M-1.
 */
async function migrateLocalToSync() {
  const flagResult = await browserAPI.storage.local.get('syncMigrationDone');
  if (flagResult.syncMigrationDone) return;

  debugLog('Starting initial sync migration and pull...');
  try {
    // 1. Pull Settings from sync and merge
    const syncSettingsResult = await browserAPI.storage.sync.get(SYNC_SETTINGS_KEY);
    const syncSettings = syncSettingsResult[SYNC_SETTINGS_KEY];
    if (syncSettings) {
      debugLog('Found sync settings, applying...');
      const localResult = await browserAPI.storage.local.get(['customColors', 'minimapVisible', 'selectionControlsVisible']);

      const mergedSettings = {
        customColors: [...(localResult.customColors || [])],
        minimapVisible: syncSettings.minimapVisible !== undefined ? syncSettings.minimapVisible : (localResult.minimapVisible !== undefined ? localResult.minimapVisible : true),
        selectionControlsVisible: syncSettings.selectionControlsVisible !== undefined ? syncSettings.selectionControlsVisible : (localResult.selectionControlsVisible !== undefined ? localResult.selectionControlsVisible : true)
      };

      // Merge custom colors
      if (syncSettings.customColors) {
        syncSettings.customColors.forEach(sc => {
          if (!mergedSettings.customColors.some(lc => lc.color.toLowerCase() === sc.color.toLowerCase())) {
            mergedSettings.customColors.push(sc);
          }
        });
      }

      await browserAPI.storage.local.set(mergedSettings);
      await saveSettingsToSync(); // Push merged back to sync
    } else {
      await saveSettingsToSync(); // No sync settings, push local
    }

    // 2. Merge Highlights
    const syncMeta = await getSyncMeta();
    const allLocal = await browserAPI.storage.local.get(null);

    // Get all sync data
    let syncData = {};
    if (syncMeta.pages.length > 0) {
      const keys = syncMeta.pages.map(p => p.syncKey);
      syncData = await browserAPI.storage.sync.get(keys);
    }

    const localUrls = Object.keys(allLocal).filter(k =>
      !['customColors', 'syncMigrationDone', 'minimapVisible', 'selectionControlsVisible', 'settings'].includes(k) &&
      !k.endsWith('_meta') && Array.isArray(allLocal[k])
    );

    const allUrls = new Set([...localUrls, ...syncMeta.pages.map(p => p.url)]);

    for (const url of allUrls) {
      const syncKey = urlToSyncKey(url);
      const remotePageData = syncData[syncKey] || {};
      const localHighlights = allLocal[url] || [];
      const localMeta = allLocal[`${url}_meta`] || {};

      // If remote has a tombstone and local is empty, skip
      if (syncMeta.deletedUrls && syncMeta.deletedUrls[url] && localHighlights.length === 0) continue;

      // Perform merge
      const merged = mergeHighlights(
        { highlights: localHighlights, deletedGroupIds: localMeta.deletedGroupIds || {} },
        { highlights: remotePageData.highlights || [], deletedGroupIds: remotePageData.deletedGroupIds || {} }
      );

      // Save merged locally
      const metaToSave = {
        title: localMeta.title || remotePageData.title || '',
        lastUpdated: localMeta.lastUpdated || remotePageData.lastUpdated || '',
        deletedGroupIds: merged.deletedGroupIds
      };

      await browserAPI.storage.local.set({
        [url]: merged.highlights,
        [`${url}_meta`]: metaToSave
      });

      // Push merged back to sync if it's not too large
      await syncSaveHighlights(url, merged.highlights, metaToSave.title, metaToSave.lastUpdated);
    }

    await browserAPI.storage.local.set({ syncMigrationDone: true });
    debugLog('Initial sync migration and pull completed.');
  } catch (e) {
    debugLog('Sync migration error:', e.message);
  }
}

// Platform detection for mobile (Firefox Android) support
let platformInfo = { os: 'unknown' };

async function initializePlatform() {
  try {
    const info = await browserAPI.runtime.getPlatformInfo();
    Object.assign(platformInfo, info);
    debugLog('Platform detected:', platformInfo);
  } catch (e) {
    debugLog('Platform detection failed:', e);
  }
}

function isMobile() {
  return platformInfo.os === 'android';
}

initializePlatform();

// 저장된 단축키 정보
let storedShortcuts = {};

// Get current shortcuts from browserAPI.commands API
async function getCurrentShortcuts() {
  if (!browserAPI.commands) return {};
  const commands = await browserAPI.commands.getAll();
  const shortcuts = {};
  
  commands.forEach(command => {
    if (command.name.startsWith('highlight_') && command.shortcut) {
      shortcuts[command.name] = ` (${command.shortcut})`;
    }
  });
  
  return shortcuts;
}

// Mutable copy of default COLORS to manage current color state without mutating the constant
let currentColors = [...COLORS];

// Load custom user-defined colors from sync (with local fallback) and merge into COLORS
async function loadCustomColors() {
  try {
    // Try sync settings first, then fall back to local
    let customColors = [];
    try {
      const syncResult = await browserAPI.storage.sync.get(SYNC_SETTINGS_KEY);
      if (syncResult[SYNC_SETTINGS_KEY] && syncResult[SYNC_SETTINGS_KEY].customColors) {
        customColors = syncResult[SYNC_SETTINGS_KEY].customColors;
        // Keep local in sync
        await browserAPI.storage.local.set({ customColors });
        debugLog('Loaded custom colors from storage.sync');
      }
    } catch (e) {
      debugLog('Failed to read sync settings, falling back to local:', e.message);
    }

    if (customColors.length === 0) {
      const result = await browserAPI.storage.local.get(['customColors']);
      customColors = result.customColors || [];
    }

    let needsUpdate = false;

    // Assign numbers to existing custom colors if they don't have them
    customColors.forEach((c, index) => {
      if (!c.colorNumber) {
        c.colorNumber = index + 1;
        needsUpdate = true;
      }
      if (!currentColors.some(existing => existing.color.toLowerCase() === c.color.toLowerCase())) {
        currentColors.push(c);
      }
    });

    // Update storage if we added numbers to existing colors
    if (needsUpdate) {
      await browserAPI.storage.local.set({ customColors });
      debugLog('Updated custom colors with numbers:', customColors);
    }

    if (customColors.length) {
      debugLog('Loaded custom colors:', customColors);
    }
  } catch (e) {
    console.error('Error loading custom colors', e);
  }
}

// 컨텍스트 메뉴 생성/업데이트 함수
async function createOrUpdateContextMenus() {
  // Context menus are not supported on Firefox Android
  if (isMobile() || !browserAPI.contextMenus) return;

  debugLog('Creating/updating context menus...');

  // 기존 메뉴 모두 제거
  try {
    await browserAPI.contextMenus.removeAll();
  } catch (error) {
    debugLog('Error removing context menus:', error);
    return;
  }

  // Create main menu item
  try {
    await browserAPI.contextMenus.create({
      id: 'highlight-text',
      title: getMessage('highlightText'),
      contexts: ['selection']
    });
  } catch (error) {
    if (!error.message.includes('duplicate id')) {
      debugLog('Error creating main context menu:', error);
    }
  }

  // Get shortcut information and display in context menu
  const commandShortcuts = await getCurrentShortcuts();

  // 단축키 정보 저장
  storedShortcuts = { ...commandShortcuts };

  for (const color of currentColors) {
    const commandName = `highlight_${color.id}`;
    const shortcutDisplay = commandShortcuts[commandName] || '';

    // Generate title with number for custom colors
    let title;
    if (color.colorNumber) {
      title = `${getMessage(color.nameKey)} ${color.colorNumber}${shortcutDisplay}`;
    } else {
      title = `${getMessage(color.nameKey)}${shortcutDisplay}`;
    }

    try {
      await browserAPI.contextMenus.create({
        id: `highlight-${color.id}`,
        parentId: 'highlight-text',
        title: title,
        contexts: ['selection']
      });
    } catch (error) {
      if (!error.message.includes('duplicate id')) {
        debugLog('Error creating color context menu:', error);
      }
    }
  }

  debugLog('Context menus created with shortcuts:', storedShortcuts);
}

// Initial setup when extension is installed or updated
browserAPI.runtime.onInstalled.addListener(async () => {
  if (DEBUG_MODE) console.log('Extension installed/updated. Debug mode:', DEBUG_MODE);
});

// 탭 활성화 시 단축키 변경사항 확인 후 필요시 컨텍스트 메뉴 업데이트
browserAPI.tabs.onActivated.addListener(async () => {
  if (isMobile() || !browserAPI.commands) return;
  const currentShortcuts = await getCurrentShortcuts();
  let hasChanged = false;

  // 저장된 단축키와 현재 단축키 비교
  for (const commandName in currentShortcuts) {
    if (storedShortcuts[commandName] !== currentShortcuts[commandName]) {
      hasChanged = true;
      break;
    }
  }

  // 단축키가 제거된 경우도 체크
  for (const commandName in storedShortcuts) {
    if (!currentShortcuts[commandName]) {
      hasChanged = true;
      break;
    }
  }

  if (hasChanged) {
    debugLog('Shortcut changes detected, updating context menus');
    await createOrUpdateContextMenus();
  }
});

// Helper function to notify tab about highlight updates
async function notifyTabHighlightsRefresh(highlights, url) {
  const tabs = await browserAPI.tabs.query({ url: url });
  for (const tab of tabs) {
    if (!tab || !tab.id) continue;
    try {
      await browserAPI.tabs.sendMessage(tab.id, {
        action: 'refreshHighlights',
        highlights: highlights
      });
    } catch (error) {
      debugLog('Error notifying tab about highlight updates:', error);
    }
  }
}

// Broadcast setting updates to all open tabs (local-first propagation).
async function broadcastSettingsToTabs(changedSettings) {
  if (!changedSettings || Object.keys(changedSettings).length === 0) return;

  const tabs = await browserAPI.tabs.query({});
  for (const tab of tabs) {
    try {
      if (changedSettings.minimapVisible !== undefined) {
        await browserAPI.tabs.sendMessage(tab.id, {
          action: 'setMinimapVisibility',
          visible: changedSettings.minimapVisible
        });
      }
      if (changedSettings.selectionControlsVisible !== undefined) {
        await browserAPI.tabs.sendMessage(tab.id, {
          action: 'setSelectionControlsVisibility',
          visible: changedSettings.selectionControlsVisible
        });
      }
    } catch (e) {
      // Some tabs may not have content script injected.
    }
  }
}

// Helper function to remove storage keys when no highlights remain
async function cleanupEmptyHighlightData(url) {
  if (!url) return;

  debugLog('Cleaning up empty highlight data for URL:', url);
  try {
    await browserAPI.storage.local.remove([url, `${url}_meta`]);
    debugLog('Successfully removed empty highlight data for URL:', url);
  } catch (error) {
    debugLog('Error removing empty highlight data:', error);
  }
}

// Handle a confirmed user-driven sync deletion for a URL.
async function applyUserDeletionFromSync(url) {
  await cleanupEmptyHighlightData(url);
  try {
    const tabs = await browserAPI.tabs.query({ url: url });
    for (const tab of tabs) {
      try {
        await browserAPI.tabs.sendMessage(tab.id, {
          action: 'refreshHighlights',
          highlights: []
        });
      } catch (e) { /* tab may not have content script */ }
    }
  } catch (e) { /* tabs query may fail */ }
}

// Context menu click handler (desktop only)
if (browserAPI.contextMenus) {
  browserAPI.contextMenus.onClicked.addListener(async (info, tab) => {
    const menuId = info.menuItemId;
    debugLog('Context menu clicked:', menuId);

    if (menuId.startsWith('highlight-') && menuId !== 'highlight-text') {
      const colorId = menuId.replace('highlight-', '');
      // Use COLORS variable directly
      const color = currentColors.find(c => c.id === colorId);

      if (color) {
        debugLog('Sending highlight action to tab:', tab.id);
        // Send highlight action and color info to Content Script
        try {
          const response = await browserAPI.tabs.sendMessage(tab.id, {
            action: 'highlight',
            color: color.color,
            text: info.selectionText
          });
          debugLog('Highlight action response:', response);
        } catch (error) {
          debugLog('Error sending highlight action:', error);
        }
      }
    }
  });
}

// Shortcut command handler (desktop only)
if (browserAPI.commands) {
  browserAPI.commands.onCommand.addListener(async (command) => {
    debugLog('Command received:', command);
    const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (activeTab) {
      let targetColor = null;
      // Determine color based on shortcut
      switch (command) {
        case 'highlight_yellow':
          targetColor = currentColors.find(c => c.id === 'yellow')?.color;
          break;
        case 'highlight_green':
          targetColor = currentColors.find(c => c.id === 'green')?.color;
          break;
        case 'highlight_blue':
          targetColor = currentColors.find(c => c.id === 'blue')?.color;
          break;
        case 'highlight_pink':
          targetColor = currentColors.find(c => c.id === 'pink')?.color;
          break;
        case 'highlight_orange':
          targetColor = currentColors.find(c => c.id === 'orange')?.color;
          break;
      }

      // Process color highlight command
      if (targetColor) {
        debugLog('Sending highlight action to tab:', activeTab.id, 'with color:', targetColor);
        try {
          const response = await browserAPI.tabs.sendMessage(activeTab.id, {
            action: 'highlight',
            color: targetColor
          });
          debugLog('Highlight action response:', response);
        } catch (error) {
          debugLog('Error sending highlight action:', error);
        }
      }
    }
  });
}

// Communication with content script (message reception handler)
browserAPI.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Handle async operations
  (async () => {
    try {
      // Handle debug mode status request
      if (message.action === 'getDebugMode') {
        sendResponse({ debugMode: DEBUG_MODE });
        return;
      }

      // Handle platform info request from content scripts
      if (message.action === 'getPlatformInfo') {
        sendResponse({ platform: platformInfo, isMobile: isMobile() });
        return;
      }

      // Handle COLORS info request from content.js
      if (message.action === 'getColors') {
        debugLog('Content script requested COLORS.');
        sendResponse({ colors: currentColors });
        return;
      }

      // Handle settings save request from popup.js (sync + local)
      if (message.action === 'saveSettings') {
        const settings = {};
        if (message.minimapVisible !== undefined) {
          settings.minimapVisible = message.minimapVisible;
        }
        if (message.selectionControlsVisible !== undefined) {
          settings.selectionControlsVisible = message.selectionControlsVisible;
        }
        const keys = Object.keys(settings);
        if (keys.length === 0) {
          sendResponse({ success: true });
          return;
        }

        const previous = await browserAPI.storage.local.get(keys);
        const changedSettings = {};
        for (const key of keys) {
          if (previous[key] !== settings[key]) {
            changedSettings[key] = settings[key];
          }
        }

        await browserAPI.storage.local.set(settings);
        await broadcastSettingsToTabs(changedSettings);

        saveSettingsToSync().catch((e) => {
          debugLog('Failed to save settings to sync (local already applied):', e.message);
        });

        debugLog('Settings saved locally and broadcasted:', settings, 'changed:', changedSettings);
        sendResponse({ success: true });
        return;
      }

      // Handle highlight information request from content.js
      if (message.action === 'getHighlights') {
        const result = await browserAPI.storage.local.get([message.url]);
        debugLog('Sending highlights for URL:', message.url, result[message.url] || []);
        sendResponse({ highlights: result[message.url] || [] });
        return;
      }

      // Handle clearCustomColors request from popup.js
      if (message.action === 'clearCustomColors') {
        // Check if there are any custom colors to clear
        const result = await browserAPI.storage.local.get(['customColors']);
        const customColors = result.customColors || [];

        if (customColors.length === 0) {
          debugLog('No custom colors to clear');
          sendResponse({ success: true, noCustomColors: true });
          return;
        }

        // Reset storage and currentColors
        await browserAPI.storage.local.set({ customColors: [] });
        // Remove custom colors from currentColors array
        currentColors = currentColors.filter(c => !c.id.startsWith('custom_'));
        debugLog('Cleared all custom colors');

        // Sync settings
        await saveSettingsToSync();

        // Recreate context menus with default colors only
        await createOrUpdateContextMenus();

        // Broadcast updated colors to all tabs
        const tabs = await browserAPI.tabs.query({});
        for (const tab of tabs) {
          try {
            await browserAPI.tabs.sendMessage(tab.id, { action: 'colorsUpdated', colors: currentColors });
          } catch (error) {
            debugLog('Error broadcasting colors to tab:', tab.id, error);
          }
        }

        sendResponse({ success: true });
        return;
      }

      // Handle addColor request from content.js
      if (message.action === 'addColor') {
        const newColorValue = message.color;
        if (!newColorValue) {
          sendResponse({ success: false });
          return;
        }

        // Load existing custom colors from storage.sync
        const stored = await browserAPI.storage.local.get(['customColors']);
        let customColors = stored.customColors || [];

        // Check duplication by value
        const exists = [...currentColors, ...customColors].some(c => c.color.toLowerCase() === newColorValue.toLowerCase());
        if (!exists) {
          // Calculate the next number for custom color naming
          const existingCustomCount = currentColors.filter(c => c.id.startsWith('custom_')).length;
          const colorNumber = existingCustomCount + 1;
          
          const newColorObj = {
            id: `custom_${Date.now()}`,
            nameKey: 'customColor',
            colorNumber: colorNumber,
            color: newColorValue
          };
          customColors.push(newColorObj);
          currentColors.push(newColorObj);
          await browserAPI.storage.local.set({ customColors });
          debugLog('Added custom color:', newColorObj);

          // Sync settings
          await saveSettingsToSync();

          // Recreate context menus to include new color
          await createOrUpdateContextMenus();

          // Broadcast updated colors to all tabs
          const tabs = await browserAPI.tabs.query({});
          for (const tab of tabs) {
            try {
              await browserAPI.tabs.sendMessage(tab.id, { action: 'colorsUpdated', colors: currentColors });
            } catch (error) {
              debugLog('Error broadcasting colors to tab:', tab.id, error);
            }
          }
        }
        sendResponse({ success: true, colors: currentColors });
        return;
      }

      // Handle highlight information save request from content.js
      if (message.action === 'saveHighlights') {
        const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];

        // Check if there are any highlights
        if (message.highlights.length > 0) {
          const saveData = {};
          saveData[message.url] = message.highlights;

          // Save highlights
          await browserAPI.storage.local.set(saveData);
          debugLog('Saved highlights for URL:', message.url, message.highlights);

          // Save metadata only if highlights exist
          const result = await browserAPI.storage.local.get([`${message.url}_meta`]);
          const metaData = result[`${message.url}_meta`] || {};
          metaData.title = currentTab.title;
          metaData.lastUpdated = new Date().toISOString();

          const metaSaveData = {};
          metaSaveData[`${message.url}_meta`] = metaData;

          await browserAPI.storage.local.set(metaSaveData);
          debugLog('Saved page metadata:', metaData);

          // Sync highlights to storage.sync
          await syncSaveHighlights(message.url, message.highlights, metaData.title, metaData.lastUpdated);

          sendResponse({ success: true });
        } else {
          // If no highlights remain, remove both data and metadata
          await cleanupEmptyHighlightData(message.url);
          await syncRemoveHighlights(message.url);
          sendResponse({ success: true });
        }
        return;
      }

      // Handler for single highlight deletion
      if (message.action === 'deleteHighlight') {
        const { url, groupId } = message;
        const result = await browserAPI.storage.local.get([url, `${url}_meta`]);
        const highlights = result[url] || [];
        const meta = result[`${url}_meta`] || {};

        // Track deleted groupId (Rule 4.1)
        const deletedGroupIds = meta.deletedGroupIds || {};
        deletedGroupIds[groupId] = Date.now();
        cleanupTombstones(deletedGroupIds);

        // groupId로 그룹 삭제
        const updatedHighlights = highlights.filter(g => g.groupId !== groupId);

        if (updatedHighlights.length > 0) {
          const lastUpdated = new Date().toISOString();
          const saveData = {};
          saveData[url] = updatedHighlights;
          saveData[`${url}_meta`] = { ...meta, deletedGroupIds, lastUpdated };
          await browserAPI.storage.local.set(saveData);
          debugLog('Highlight group deleted:', groupId, 'from URL:', url);

          // Sync updated highlights
          await syncSaveHighlights(url, updatedHighlights, meta.title || '', lastUpdated);

          if (message.notifyRefresh) {
            await notifyTabHighlightsRefresh(updatedHighlights, url);
          }
          sendResponse({
            success: true,
            highlights: updatedHighlights
          });
        } else {
          await cleanupEmptyHighlightData(url);
          await syncRemoveHighlights(url);
          if (message.notifyRefresh) {
            await notifyTabHighlightsRefresh([], url);
          }
          sendResponse({
            success: true,
            highlights: []
          });
        }
        return;
      }

      // Handler for clearing all highlights
      if (message.action === 'clearAllHighlights') {
        const { url } = message;

        // Remove both data and metadata for the URL
        await cleanupEmptyHighlightData(url);
        await syncRemoveHighlights(url);

        // Notify content script to refresh highlights if requested
        if (message.notifyRefresh) {
          await notifyTabHighlightsRefresh([], url);
        }

        sendResponse({ success: true });
        return;
      }

      // Handler for getting all highlighted pages
      if (message.action === 'getAllHighlightedPages') {
        const result = await browserAPI.storage.local.get(null);
        const pages = [];

        // Filter items with URLs as keys from storage (exclude metadata, settings, and internal keys)
        const skipKeys = new Set(['customColors', 'syncMigrationDone', 'minimapVisible', 'selectionControlsVisible']);
        for (const key in result) {
          if (skipKeys.has(key)) continue;
          if (Array.isArray(result[key]) && result[key].length > 0 && !key.endsWith('_meta')) {
            const url = key;
            const metaKey = `${url}_meta`;
            const metadata = result[metaKey] || {};

            pages.push({
              url: url,
              highlights: result[url],
              highlightCount: result[url].length,
              title: metadata.title || '',
              lastUpdated: metadata.lastUpdated || ''
            });
          }
        }

        debugLog('Retrieved all highlighted pages:', pages);

        // Sort pages by most recent update
        pages.sort((a, b) => {
          // Treat pages without lastUpdated as oldest
          if (!a.lastUpdated) return 1;
          if (!b.lastUpdated) return -1;

          // Sort in descending order (newest date first)
          return new Date(b.lastUpdated) - new Date(a.lastUpdated);
        });

        sendResponse({ success: true, pages: pages });
        return;
      }

      // Handler for deleting all highlighted pages
      if (message.action === 'deleteAllHighlightedPages') {
        const result = await browserAPI.storage.local.get(null);
        const keysToDelete = [];

        // Find all highlight data and metadata keys
        const skipKeysDelete = new Set(['customColors', 'syncMigrationDone', 'minimapVisible', 'selectionControlsVisible']);
        for (const key in result) {
          if (skipKeysDelete.has(key)) continue;
          if (Array.isArray(result[key]) && result[key].length > 0 && !key.endsWith('_meta')) {
            keysToDelete.push(key, `${key}_meta`);
          }
        }

        if (keysToDelete.length > 0) {
          await browserAPI.storage.local.remove(keysToDelete);
          debugLog('All highlighted pages deleted:', keysToDelete);

          // Clear all synced highlights
          try {
            const meta = await getSyncMeta();
            const syncKeysToRemove = meta.pages.map(p => p.syncKey);

            // Mark all current synced pages as explicitly user-deleted first.
            const now = Date.now();
            for (const page of meta.pages) {
              if (page.url) {
                meta.deletedUrls[page.url] = now;
              }
            }
            await browserAPI.storage.sync.set({ [SYNC_META_KEY]: meta });

            if (syncKeysToRemove.length > 0) {
              await browserAPI.storage.sync.remove(syncKeysToRemove);
            }
            await browserAPI.storage.sync.set({
              [SYNC_META_KEY]: {
                ...meta,
                pages: [],
                totalSize: 0
              }
            });
            debugLog('Cleared all synced highlights');
          } catch (e) {
            debugLog('Failed to clear synced highlights:', e.message);
          }
        }

        sendResponse({ success: true, deletedCount: keysToDelete.length / 2 });
        return;
      }
    } catch (error) {
      debugLog('Error in message handler:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // Keep message channel open for async response
});

// ===================================================================
// Storage.onChanged listener for cross-device sync
// ===================================================================
browserAPI.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'sync') return;

  debugLog('Sync storage changed:', Object.keys(changes));

  // Handle settings changes from another device
  if (changes[SYNC_SETTINGS_KEY]) {
    const newSettings = changes[SYNC_SETTINGS_KEY].newValue;
    if (!newSettings) return;

    debugLog('Received settings sync update:', newSettings);

    // Update custom colors
    if (newSettings.customColors) {
      await browserAPI.storage.local.set({ customColors: newSettings.customColors });
      currentColors = [...COLORS];
      newSettings.customColors.forEach(c => {
        if (!currentColors.some(existing => existing.color.toLowerCase() === c.color.toLowerCase())) {
          currentColors.push(c);
        }
      });
      await createOrUpdateContextMenus();

      // Broadcast to all tabs
      const tabs = await browserAPI.tabs.query({});
      for (const tab of tabs) {
        try {
          await browserAPI.tabs.sendMessage(tab.id, { action: 'colorsUpdated', colors: currentColors });
        } catch (e) { /* tab may not have content script */ }
      }
    }

    // Update minimap visibility
    if (newSettings.minimapVisible !== undefined) {
      await browserAPI.storage.local.set({ minimapVisible: newSettings.minimapVisible });
      const tabs = await browserAPI.tabs.query({});
      for (const tab of tabs) {
        try {
          await browserAPI.tabs.sendMessage(tab.id, {
            action: 'setMinimapVisibility',
            visible: newSettings.minimapVisible
          });
        } catch (e) { /* tab may not have content script */ }
      }
    }

    // Update selection controls visibility
    if (newSettings.selectionControlsVisible !== undefined) {
      await browserAPI.storage.local.set({ selectionControlsVisible: newSettings.selectionControlsVisible });
      const tabs = await browserAPI.tabs.query({});
      for (const tab of tabs) {
        try {
          await browserAPI.tabs.sendMessage(tab.id, {
            action: 'setSelectionControlsVisibility',
            visible: newSettings.selectionControlsVisible
          });
        } catch (e) { /* tab may not have content script */ }
      }
    }
  }

  // Handle highlight changes from another device
  const scheduleRemovalResolution = (oldData, retryCount = 0) => {
    if (!oldData || !oldData.url) return;
    const url = oldData.url;

    const existing = pendingSyncRemovalResolutions.get(url);
    if (existing) {
      clearTimeout(existing.timeoutId);
    }

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

  for (const key of Object.keys(changes)) {
    if (!key.startsWith(SYNC_HIGHLIGHT_PREFIX)) continue;

    const newData = changes[key].newValue;
    if (newData && newData.url) {
      const url = newData.url;
      // 1. Fetch current local data for merging
      const localResult = await browserAPI.storage.local.get([url, `${url}_meta`]);
      const localHighlights = localResult[url] || [];
      const localMeta = localResult[`${url}_meta`] || {};

      // 2. Perform merge (Rule 4.1, M-6)
      const merged = mergeHighlights(
        { highlights: localHighlights, deletedGroupIds: localMeta.deletedGroupIds || {} },
        { highlights: newData.highlights || [], deletedGroupIds: newData.deletedGroupIds || {} }
      );

      // 3. Update local storage
      const saveData = {};
      saveData[url] = merged.highlights;
      saveData[`${url}_meta`] = {
        ...localMeta,
        title: newData.title || localMeta.title || '',
        lastUpdated: newData.lastUpdated || localMeta.lastUpdated || '',
        deletedGroupIds: merged.deletedGroupIds
      };
      await browserAPI.storage.local.set(saveData);

      debugLog('Synced highlights merged and applied for:', url);

      // 4. Refresh tab if open
      try {
        const tabs = await browserAPI.tabs.query({ url: url });
        for (const tab of tabs) {
          await browserAPI.tabs.sendMessage(tab.id, {
            action: 'refreshHighlights',
            highlights: merged.highlights
          });
        }
      } catch (e) { /* tab may not be open */ }
    } else if (!newData) {
      // Highlight was removed from sync (either eviction or user delete)
      const oldData = changes[key].oldValue;
      if (oldData && oldData.url) {
        // Resolve intent with retries because sync item removal and sync_meta updates are not ordered.
        scheduleRemovalResolution(oldData);
      }
    }
  }
});

// -------------------------------------------------------------------
// Initial load: ensure custom colors are loaded and context menus exist
// -------------------------------------------------------------------
(async () => {
  try {
    await loadCustomColors();
    await createOrUpdateContextMenus();
    await migrateLocalToSync();
  } catch (e) {
    console.error('Initialization error in background script', e);
  }
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    cleanupTombstones,
    normalizeSyncMeta,
    urlToSyncKey,
    mergeHighlights,
    isMobile,
    platformInfo
  };
}
