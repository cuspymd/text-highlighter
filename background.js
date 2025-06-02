import { COLORS, getMessage } from './constants.js';

// Debug mode setting - change to true during development
const DEBUG_MODE = false;

// Debug log function
function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log(...args);
  }
}

// 저장된 단축키 정보
let storedShortcuts = {};

// 컨텍스트 메뉴 생성/업데이트 함수
async function createOrUpdateContextMenus() {
  debugLog('Creating/updating context menus...');

  // 기존 메뉴 모두 제거
  await chrome.contextMenus.removeAll();

  // Create main menu item
  chrome.contextMenus.create({
    id: 'highlight-text',
    title: getMessage('highlightText'),
    contexts: ['selection']
  });

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

  COLORS.forEach(color => {
    const commandName = `highlight_${color.id}`;
    const shortcutDisplay = commandShortcuts[commandName] || '';

    chrome.contextMenus.create({
      id: `highlight-${color.id}`,
      parentId: 'highlight-text',
      title: `${getMessage(color.nameKey)}${shortcutDisplay}`,
      contexts: ['selection']
    });
  });

  // Add remove highlight menu item
  chrome.contextMenus.create({
    id: 'remove-highlight',
    parentId: 'highlight-text',
    title: getMessage('removeHighlight'),
    contexts: ['selection']
  });

  debugLog('Context menus created with shortcuts:', storedShortcuts);
}

// Initial setup when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  if (DEBUG_MODE) console.log('Extension installed/updated. Debug mode:', DEBUG_MODE);
  createOrUpdateContextMenus();
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
    createOrUpdateContextMenus();
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
    const color = COLORS.find(c => c.id === colorId);

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
  else if (menuId === 'remove-highlight') {
    debugLog('Sending remove highlight action to tab:', tab.id);
    // Send remove highlight action to Content Script
    chrome.tabs.sendMessage(tab.id, {
      action: 'removeHighlight',
      text: info.selectionText
    }, response => {
      debugLog('Remove highlight action response:', response);
    });
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
        targetColor = COLORS.find(c => c.id === 'yellow')?.color;
        break;
      case 'highlight_green':
        targetColor = COLORS.find(c => c.id === 'green')?.color;
        break;
      case 'highlight_blue':
        targetColor = COLORS.find(c => c.id === 'blue')?.color;
        break;
      case 'highlight_pink':
        targetColor = COLORS.find(c => c.id === 'pink')?.color;
        break;
      case 'highlight_orange':
        targetColor = COLORS.find(c => c.id === 'orange')?.color;
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
        sendResponse({ colors: COLORS });
        return;
      }

      // Handle highlight information request from content.js
      if (message.action === 'getHighlights') {
        const result = await chrome.storage.local.get([message.url]);
        debugLog('Sending highlights for URL:', message.url, result[message.url] || []);
        sendResponse({ highlights: result[message.url] || [] });
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
        const { url, highlightId } = message;

        const result = await chrome.storage.local.get([url]);
        const highlights = result[url] || [];
        const updatedHighlights = highlights.filter(h => h.id !== highlightId);

        if (updatedHighlights.length > 0) {
          // If highlights remain, update the storage
          const saveData = {};
          saveData[url] = updatedHighlights;

          await chrome.storage.local.set(saveData);
          debugLog('Highlight deleted:', highlightId, 'from URL:', url);

          // Notify content script to refresh highlights if requested
          if (message.notifyRefresh) {
            await notifyTabHighlightsRefresh(updatedHighlights, url);
          }

          sendResponse({
            success: true,
            highlights: updatedHighlights
          });
        } else {
          // If no highlights remain, remove both data and metadata
          await cleanupEmptyHighlightData(url);

          // Notify content script to refresh highlights if requested
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
