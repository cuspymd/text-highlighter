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

function normalizeUrlKey(urlString) {
  if (!urlString) return '';
  try {
    const url = new URL(urlString);
    if (url.protocol === 'file:') {
      return `file://${url.pathname}`;
    }
    if (url.origin === 'null') {
      return `${url.protocol}//${url.pathname}`;
    }
    return `${url.origin}${url.pathname}`;
  } catch (e) {
    const noHash = urlString.split('#')[0];
    return noHash.split('?')[0];
  }
}

function mergeHighlights(primary = [], secondary = []) {
  const merged = new Map();
  for (const item of primary) {
    const key = item?.groupId || JSON.stringify(item);
    merged.set(key, item);
  }
  for (const item of secondary) {
    const key = item?.groupId || JSON.stringify(item);
    if (!merged.has(key)) {
      merged.set(key, item);
    }
  }
  return Array.from(merged.values());
}

function mergeMeta(targetMeta = {}, sourceMeta = {}, displayUrl = '') {
  const merged = { ...targetMeta };
  if (!merged.title && sourceMeta.title) {
    merged.title = sourceMeta.title;
  }
  const targetDate = Date.parse(merged.lastUpdated || '');
  const sourceDate = Date.parse(sourceMeta.lastUpdated || '');
  if (sourceDate && (!targetDate || sourceDate > targetDate)) {
    merged.lastUpdated = sourceMeta.lastUpdated;
  }
  if (displayUrl) {
    merged.displayUrl = displayUrl;
  }
  return merged;
}

// Debug mode setting - change to true during development
const DEBUG_MODE = false;

// Debug log function
const debugLog = DEBUG_MODE ? console.log.bind(console) : () => {};

// 저장된 단축키 정보
let storedShortcuts = {};

// Get current shortcuts from browserAPI.commands API
async function getCurrentShortcuts() {
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

// Load custom user-defined colors from local storage and merge into COLORS
async function loadCustomColors() {
  try {
    const result = await browserAPI.storage.local.get(['customColors']);
    let customColors = result.customColors || [];
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
      debugLog('Loaded custom colors from storage.local:', customColors);
    }
  } catch (e) {
    console.error('Error loading custom colors', e);
  }
}

// 컨텍스트 메뉴 생성/업데이트 함수
async function createOrUpdateContextMenus() {
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
async function notifyTabHighlightsRefresh(highlights, urlKey, pageUrl = '') {
  const urlPattern = urlKey ? `${urlKey}*` : pageUrl;
  const tabs = await browserAPI.tabs.query({ url: urlPattern });
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
async function cleanupEmptyHighlightData(urlKey, pageUrl = '') {
  if (!urlKey && !pageUrl) return;

  debugLog('Cleaning up empty highlight data for URL:', urlKey || pageUrl);
  try {
    const keysToRemove = [];
    if (urlKey) {
      keysToRemove.push(urlKey, `${urlKey}_meta`);
    }
    if (pageUrl && pageUrl !== urlKey) {
      keysToRemove.push(pageUrl, `${pageUrl}_meta`);
    }
    await browserAPI.storage.local.remove(keysToRemove);
    debugLog('Successfully removed empty highlight data for URL:', urlKey || pageUrl);
  } catch (error) {
    debugLog('Error removing empty highlight data:', error);
  }
}

// Context menu click handler
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

// Shortcut command handler
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

      // Handle COLORS info request from content.js
      if (message.action === 'getColors') {
        debugLog('Content script requested COLORS.');
        sendResponse({ colors: currentColors });
        return;
      }

      // Handle highlight information request from content.js
      if (message.action === 'getHighlights') {
        const urlKey = normalizeUrlKey(message.urlKey || message.url || message.pageUrl);
        const pageUrl = message.pageUrl || '';
        const result = await browserAPI.storage.local.get([urlKey, pageUrl, `${urlKey}_meta`, `${pageUrl}_meta`]);

        if (pageUrl && pageUrl !== urlKey && !result[urlKey] && Array.isArray(result[pageUrl])) {
          const mergedHighlights = mergeHighlights([], result[pageUrl]);
          const meta = mergeMeta(result[`${urlKey}_meta`] || {}, result[`${pageUrl}_meta`] || {}, urlKey);
          await browserAPI.storage.local.set({
            [urlKey]: mergedHighlights,
            [`${urlKey}_meta`]: meta
          });
          await browserAPI.storage.local.remove([pageUrl, `${pageUrl}_meta`]);
          debugLog('Migrated highlights to URL key:', urlKey);
          sendResponse({ highlights: mergedHighlights });
          return;
        }

        debugLog('Sending highlights for URL key:', urlKey, result[urlKey] || []);
        sendResponse({ highlights: result[urlKey] || [] });
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
        const urlKey = normalizeUrlKey(message.urlKey || message.url || message.pageUrl);
        const pageUrl = message.pageUrl || '';
        const displayUrl = normalizeUrlKey(message.displayUrl || urlKey || pageUrl);

        // Check if there are any highlights
        if (message.highlights.length > 0) {
          const saveData = {};
          saveData[urlKey] = message.highlights;

          // Save highlights
          await browserAPI.storage.local.set(saveData);
          debugLog('Saved highlights for URL key:', urlKey, message.highlights);

          // Save metadata only if highlights exist
          const result = await browserAPI.storage.local.get([`${urlKey}_meta`, `${pageUrl}_meta`]);
          const metaData = mergeMeta(result[`${urlKey}_meta`] || {}, result[`${pageUrl}_meta`] || {}, displayUrl);
          metaData.title = currentTab.title;
          metaData.lastUpdated = new Date().toISOString();

          const metaSaveData = {};
          metaSaveData[`${urlKey}_meta`] = metaData;

          await browserAPI.storage.local.set(metaSaveData);
          debugLog('Saved page metadata:', metaData);
          if (pageUrl && pageUrl !== urlKey) {
            await browserAPI.storage.local.remove([pageUrl, `${pageUrl}_meta`]);
          }
          sendResponse({ success: true });
        } else {
          // If no highlights remain, remove both data and metadata
          await cleanupEmptyHighlightData(urlKey, pageUrl);
          sendResponse({ success: true });
        }
        return;
      }

      // Handler for single highlight deletion
      if (message.action === 'deleteHighlight') {
        const { urlKey, pageUrl, groupId } = message;
        const normalizedKey = normalizeUrlKey(urlKey || pageUrl);
        const result = await browserAPI.storage.local.get([normalizedKey, pageUrl]);
        const highlights = result[normalizedKey] || result[pageUrl] || [];
        // groupId로 그룹 삭제
        const updatedHighlights = highlights.filter(g => g.groupId !== groupId);
        if (updatedHighlights.length > 0) {
          const saveData = {};
          saveData[normalizedKey] = updatedHighlights;
          await browserAPI.storage.local.set(saveData);
          debugLog('Highlight group deleted:', groupId, 'from URL key:', normalizedKey);
          if (message.notifyRefresh) {
            await notifyTabHighlightsRefresh(updatedHighlights, normalizedKey, pageUrl);
          }
          sendResponse({
            success: true,
            highlights: updatedHighlights
          });
        } else {
          await cleanupEmptyHighlightData(normalizedKey, pageUrl);
          if (message.notifyRefresh) {
            await notifyTabHighlightsRefresh([], normalizedKey, pageUrl);
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
        const { urlKey, pageUrl } = message;
        const normalizedKey = normalizeUrlKey(urlKey || pageUrl);

        // Remove both data and metadata for the URL
        await cleanupEmptyHighlightData(normalizedKey, pageUrl);

        // Notify content script to refresh highlights if requested
        if (message.notifyRefresh) {
          await notifyTabHighlightsRefresh([], normalizedKey, pageUrl);
        }

        sendResponse({ success: true });
        return;
      }

      // Handler for getting all highlighted pages
      if (message.action === 'getAllHighlightedPages') {
        const result = await browserAPI.storage.local.get(null);
        const pages = [];
        const updates = {};
        const removals = [];

        // Filter items with URLs as keys from storage (exclude metadata and customColors)
        for (const key in result) {
          if (key === 'customColors') {
            continue; // skip customColors key
          }
          if (Array.isArray(result[key]) && result[key].length > 0 && !key.endsWith('_meta')) {
            const urlKey = normalizeUrlKey(key);
            const metaKey = `${key}_meta`;
            const normalizedMetaKey = `${urlKey}_meta`;
            const metadata = result[metaKey] || {};
            const normalizedMeta = result[normalizedMetaKey] || {};
            let highlights = result[key] || [];

            if (urlKey !== key) {
              const existing = Array.isArray(result[urlKey]) ? result[urlKey] : [];
              highlights = mergeHighlights(existing, highlights);
              updates[urlKey] = highlights;
              updates[normalizedMetaKey] = mergeMeta(normalizedMeta, metadata, urlKey);
              removals.push(key, metaKey);
            }

            pages.push({
              url: urlKey,
              highlights: highlights,
              highlightCount: highlights.length,
              title: (urlKey !== key ? (updates[normalizedMetaKey]?.title || '') : (metadata.title || '')),
              lastUpdated: (urlKey !== key ? (updates[normalizedMetaKey]?.lastUpdated || '') : (metadata.lastUpdated || ''))
            });
          }
        }

        if (Object.keys(updates).length > 0) {
          await browserAPI.storage.local.set(updates);
        }
        if (removals.length > 0) {
          await browserAPI.storage.local.remove(removals);
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
        for (const key in result) {
          if (key === 'customColors') {
            continue; // skip customColors key
          }
          if (Array.isArray(result[key]) && result[key].length > 0 && !key.endsWith('_meta')) {
            keysToDelete.push(key, `${key}_meta`);
          }
        }

        if (keysToDelete.length > 0) {
          await browserAPI.storage.local.remove(keysToDelete);
          debugLog('All highlighted pages deleted:', keysToDelete);
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

// -------------------------------------------------------------------
// Initial load: ensure custom colors are loaded and context menus exist
// -------------------------------------------------------------------
(async () => {
  try {
    await loadCustomColors();
    await createOrUpdateContextMenus();
  } catch (e) {
    console.error('Initialization error in background script', e);
  }
})();
