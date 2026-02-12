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

// Write to storage.sync with local fallback
async function syncSet(data) {
  await browserAPI.storage.local.set(data);
  try {
    await browserAPI.storage.sync.set(data);
    debugLog('Saved to storage.sync:', Object.keys(data));
  } catch (e) {
    debugLog('storage.sync.set failed, local only:', e.message);
  }
}

// Read from storage.sync with local fallback
async function syncGet(keys) {
  try {
    const syncResult = await browserAPI.storage.sync.get(keys);
    if (Object.keys(syncResult).length > 0) {
      return syncResult;
    }
  } catch (e) {
    debugLog('storage.sync.get failed, falling back to local:', e.message);
  }
  return await browserAPI.storage.local.get(keys);
}

// Remove from both storage.sync and storage.local
async function syncRemove(keys) {
  await browserAPI.storage.local.remove(keys);
  try {
    await browserAPI.storage.sync.remove(keys);
  } catch (e) {
    debugLog('storage.sync.remove failed:', e.message);
  }
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
  const data = { url, title, lastUpdated, highlights };
  const dataStr = JSON.stringify({ [syncKey]: data });
  const dataSize = new TextEncoder().encode(dataStr).byteLength;

  // Skip if single item exceeds per-item quota
  if (dataSize > SYNC_QUOTA_BYTES_PER_ITEM) {
    debugLog('Highlight data exceeds 8KB per-item limit, sync skipped for:', url, `(${dataSize}B)`);
    return;
  }

  try {
    // Check current sync usage and evict old pages if needed
    const meta = await getSyncMeta();
    let totalSize = meta.totalSize || 0;

    // If adding this would exceed budget, evict oldest pages
    while (totalSize + dataSize > SYNC_HIGHLIGHT_BUDGET && meta.pages.length > 0) {
      // Sort by lastUpdated ascending (oldest first)
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

    // Update meta
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
    debugLog('Highlights synced for:', url, `(${dataSize}B, total: ${meta.totalSize}B)`);
  } catch (e) {
    debugLog('Failed to sync highlights:', e.message);
  }
}

// Remove a page's highlights from sync storage
async function syncRemoveHighlights(url) {
  const syncKey = urlToSyncKey(url);
  try {
    const meta = await getSyncMeta();
    const idx = meta.pages.findIndex(p => p.syncKey === syncKey);
    if (idx >= 0) {
      meta.totalSize = (meta.totalSize || 0) - (meta.pages[idx].size || 0);
      meta.pages.splice(idx, 1);
      await browserAPI.storage.sync.remove(syncKey);
      await browserAPI.storage.sync.set({ [SYNC_META_KEY]: meta });
      debugLog('Removed highlights from sync for:', url);
    }
  } catch (e) {
    debugLog('Failed to remove highlights from sync:', e.message);
  }
}

// Get sync metadata
async function getSyncMeta() {
  try {
    const result = await browserAPI.storage.sync.get(SYNC_META_KEY);
    return result[SYNC_META_KEY] || { pages: [], totalSize: 0 };
  } catch (e) {
    return { pages: [], totalSize: 0 };
  }
}

// Migrate existing local data to sync on first run
async function migrateLocalToSync() {
  const flagResult = await browserAPI.storage.local.get('syncMigrationDone');
  if (flagResult.syncMigrationDone) return;

  debugLog('Starting initial sync migration...');
  try {
    // Migrate settings
    await saveSettingsToSync();

    // Migrate highlights (recent pages, within budget)
    const allLocal = await browserAPI.storage.local.get(null);
    const pages = [];
    for (const key in allLocal) {
      if (key === 'customColors' || key === 'syncMigrationDone' ||
          key === 'minimapVisible' || key === 'selectionControlsVisible' ||
          key.endsWith('_meta')) continue;
      if (Array.isArray(allLocal[key]) && allLocal[key].length > 0) {
        const metaKey = `${key}_meta`;
        const meta = allLocal[metaKey] || {};
        pages.push({
          url: key,
          highlights: allLocal[key],
          title: meta.title || '',
          lastUpdated: meta.lastUpdated || ''
        });
      }
    }

    // Sort by most recent first
    pages.sort((a, b) => (b.lastUpdated || '').localeCompare(a.lastUpdated || ''));

    for (const page of pages) {
      await syncSaveHighlights(page.url, page.highlights, page.title, page.lastUpdated);
    }

    await browserAPI.storage.local.set({ syncMigrationDone: true });
    debugLog('Sync migration completed. Migrated', pages.length, 'pages.');
  } catch (e) {
    debugLog('Sync migration error:', e.message);
  }
}

// Platform detection for mobile (Firefox Android) support
let platformInfo = { os: 'unknown' };

async function initializePlatform() {
  try {
    platformInfo = await browserAPI.runtime.getPlatformInfo();
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
  try {
    await browserAPI.tabs.sendMessage(tabs[0].id, {
      action: 'refreshHighlights',
      highlights: highlights
    });
  } catch (error) {
    debugLog('Error notifying tab about highlight updates:', error);
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
        await browserAPI.storage.local.set(settings);
        await saveSettingsToSync();
        debugLog('Settings saved (local + sync):', settings);
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
        const result = await browserAPI.storage.local.get([url]);
        const highlights = result[url] || [];
        // groupId로 그룹 삭제
        const updatedHighlights = highlights.filter(g => g.groupId !== groupId);
        if (updatedHighlights.length > 0) {
          const saveData = {};
          saveData[url] = updatedHighlights;
          await browserAPI.storage.local.set(saveData);
          debugLog('Highlight group deleted:', groupId, 'from URL:', url);

          // Sync updated highlights
          const metaResult = await browserAPI.storage.local.get([`${url}_meta`]);
          const meta = metaResult[`${url}_meta`] || {};
          await syncSaveHighlights(url, updatedHighlights, meta.title || '', meta.lastUpdated || '');

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
            if (syncKeysToRemove.length > 0) {
              await browserAPI.storage.sync.remove(syncKeysToRemove);
            }
            await browserAPI.storage.sync.set({ [SYNC_META_KEY]: { pages: [], totalSize: 0 } });
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
  for (const key of Object.keys(changes)) {
    if (!key.startsWith(SYNC_HIGHLIGHT_PREFIX)) continue;

    const newData = changes[key].newValue;
    if (newData && newData.url && newData.highlights) {
      // Update local storage with synced highlights
      const saveData = {};
      saveData[newData.url] = newData.highlights;
      await browserAPI.storage.local.set(saveData);

      const metaSaveData = {};
      metaSaveData[`${newData.url}_meta`] = {
        title: newData.title || '',
        lastUpdated: newData.lastUpdated || ''
      };
      await browserAPI.storage.local.set(metaSaveData);

      debugLog('Synced highlights applied for:', newData.url);

      // Refresh tab if open
      try {
        const tabs = await browserAPI.tabs.query({ url: newData.url });
        for (const tab of tabs) {
          await browserAPI.tabs.sendMessage(tab.id, {
            action: 'refreshHighlights',
            highlights: newData.highlights
          });
        }
      } catch (e) { /* tab may not be open */ }
    } else if (!newData) {
      // Highlight was removed from sync - find and clean local
      const oldData = changes[key].oldValue;
      if (oldData && oldData.url) {
        await cleanupEmptyHighlightData(oldData.url);
        try {
          const tabs = await browserAPI.tabs.query({ url: oldData.url });
          for (const tab of tabs) {
            await browserAPI.tabs.sendMessage(tab.id, {
              action: 'refreshHighlights',
              highlights: []
            });
          }
        } catch (e) { /* tab may not be open */ }
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
