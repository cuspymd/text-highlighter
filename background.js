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
          sendResponse({ success: true });
        } else {
          // If no highlights remain, remove both data and metadata
          await cleanupEmptyHighlightData(message.url);
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
          if (message.notifyRefresh) {
            await notifyTabHighlightsRefresh(updatedHighlights, url);
          }
          sendResponse({
            success: true,
            highlights: updatedHighlights
          });
        } else {
          await cleanupEmptyHighlightData(url);
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

        // Filter items with URLs as keys from storage (exclude metadata and customColors)
        for (const key in result) {
          if (key === 'customColors') {
            continue; // skip customColors key
          }
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
