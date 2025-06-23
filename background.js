import { COLORS, getMessage } from './constants.js';

// Debug mode setting - change to true during development
const DEBUG_MODE = false;

// Debug log function
const debugLog = DEBUG_MODE ? console.log.bind(console) : () => {};

// 저장된 단축키 정보
let storedShortcuts = {};

// Mutable copy of default COLORS to manage current color state without mutating the constant
let currentColors = [...COLORS];

// Load custom user-defined colors from local storage and merge into COLORS
async function loadCustomColors() {
  try {
    const result = await chrome.storage.local.get(['customColors']);
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
      await chrome.storage.local.set({ customColors });
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
    await chrome.contextMenus.removeAll();
  } catch (error) {
    debugLog('Error removing context menus:', error);
  }

  // Create main menu item
  try {
    chrome.contextMenus.create({
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
  const commands = await chrome.commands.getAll();
  const commandShortcuts = {};

  commands.forEach(command => {
    if (command.name.startsWith('highlight_') && command.shortcut) {
      // Save shortcut by matching command name defined in commands.json
      commandShortcuts[command.name] = ` (${command.shortcut})`;
    }
  });

  // 단축키 정보 저장
  storedShortcuts = { ...commandShortcuts };

  currentColors.forEach(color => {
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
      chrome.contextMenus.create({
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
  });

  debugLog('Context menus created with shortcuts:', storedShortcuts);
}

// Initial setup when extension is installed or updated
chrome.runtime.onInstalled.addListener(async () => {
  if (DEBUG_MODE) console.log('Extension installed/updated. Debug mode:', DEBUG_MODE);
});

// 탭 활성화 시 단축키 변경사항 확인 후 필요시 컨텍스트 메뉴 업데이트
chrome.tabs.onActivated.addListener(async () => {
  const commands = await chrome.commands.getAll();
  const currentShortcuts = {};
  let hasChanged = false;

  commands.forEach(command => {
    if (command.name.startsWith('highlight_') && command.shortcut) {
      currentShortcuts[command.name] = ` (${command.shortcut})`;
    }
  });

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
  const tabs = await chrome.tabs.query({ url: url });
  if (tabs[0] && tabs[0].id) {
    chrome.tabs.sendMessage(tabs[0].id, {
      action: 'refreshHighlights',
      highlights: highlights
    });
  }
}

// Helper function to remove storage keys when no highlights remain
async function cleanupEmptyHighlightData(url) {
  if (!url) return;

  debugLog('Cleaning up empty highlight data for URL:', url);
  try {
    await chrome.storage.local.remove([url, `${url}_meta`]);
    debugLog('Successfully removed empty highlight data for URL:', url);
  } catch (error) {
    debugLog('Error removing empty highlight data:', error);
  }
}

// Context menu click handler
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const menuId = info.menuItemId;
  debugLog('Context menu clicked:', menuId);

  if (menuId.startsWith('highlight-') && menuId !== 'highlight-text') {
    const colorId = menuId.replace('highlight-', '');
    // Use COLORS variable directly
    const color = currentColors.find(c => c.id === colorId);

    if (color) {
      debugLog('Sending highlight action to tab:', tab.id);
      // Send highlight action and color info to Content Script
      chrome.tabs.sendMessage(tab.id, {
        action: 'highlight',
        color: color.color,
        text: info.selectionText
      }, response => {
        debugLog('Highlight action response:', response);
      });
    }
  }
});

// Shortcut command handler
chrome.commands.onCommand.addListener(async (command) => {
  debugLog('Command received:', command);
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
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
      chrome.tabs.sendMessage(activeTab.id, {
        action: 'highlight',
        color: targetColor
      }, response => {
        debugLog('Highlight action response:', response);
      });
    }
  }
});

// Communication with content script (message reception handler)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
        const result = await chrome.storage.local.get([message.url]);
        debugLog('Sending highlights for URL:', message.url, result[message.url] || []);
        sendResponse({ highlights: result[message.url] || [] });
        return;
      }

      // Handle clearCustomColors request from popup.js
      if (message.action === 'clearCustomColors') {
        // Reset storage and currentColors
        await chrome.storage.local.set({ customColors: [] });
        // Remove custom colors from currentColors array
        currentColors = currentColors.filter(c => !c.id.startsWith('custom_'));
        debugLog('Cleared all custom colors');

        // Recreate context menus with default colors only
        await createOrUpdateContextMenus();

        // Broadcast updated colors to all tabs
        const tabs = await chrome.tabs.query({});
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { action: 'colorsUpdated', colors: currentColors });
        });

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
        const stored = await chrome.storage.local.get(['customColors']);
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
          await chrome.storage.local.set({ customColors });
          debugLog('Added custom color:', newColorObj);

          // Recreate context menus to include new color
          await createOrUpdateContextMenus();

          // Broadcast updated colors to all tabs
          const tabs = await chrome.tabs.query({});
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { action: 'colorsUpdated', colors: currentColors });
          });
        }
        sendResponse({ success: true, colors: currentColors });
        return;
      }

      // Handle highlight information save request from content.js
      if (message.action === 'saveHighlights') {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];

        // Check if there are any highlights
        if (message.highlights.length > 0) {
          const saveData = {};
          saveData[message.url] = message.highlights;

          // Save highlights
          await chrome.storage.local.set(saveData);
          debugLog('Saved highlights for URL:', message.url, message.highlights);

          // Save metadata only if highlights exist
          const result = await chrome.storage.local.get([`${message.url}_meta`]);
          const metaData = result[`${message.url}_meta`] || {};
          metaData.title = currentTab.title;
          metaData.lastUpdated = new Date().toISOString();

          const metaSaveData = {};
          metaSaveData[`${message.url}_meta`] = metaData;

          await chrome.storage.local.set(metaSaveData);
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
        const result = await chrome.storage.local.get([url]);
        const highlights = result[url] || [];
        // groupId로 그룹 삭제
        const updatedHighlights = highlights.filter(g => g.groupId !== groupId);
        if (updatedHighlights.length > 0) {
          const saveData = {};
          saveData[url] = updatedHighlights;
          await chrome.storage.local.set(saveData);
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
