import { COLORS, getMessage } from './constants.js';

// Debug mode setting - change to true during development
const DEBUG_MODE = true;

// Initial setup when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  if (DEBUG_MODE) console.log('Extension installed/updated. Debug mode:', DEBUG_MODE);

  // Create main menu item
  chrome.contextMenus.create({
    id: 'highlight-text',
    title: getMessage('highlightText'),
    contexts: ['selection']
  });

  // Get shortcut information and display in context menu
  chrome.commands.getAll((commands) => {
    const commandShortcuts = {};
    commands.forEach(command => {
      if (command.name.startsWith('highlight_') && command.shortcut) {
        // Save shortcut by matching command name defined in commands.json
        commandShortcuts[command.name] = ` (${command.shortcut})`;
      }
    });

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
  });
});

// Debug log function
function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log(...args);
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
chrome.commands.onCommand.addListener((command) => {
  debugLog('Command received:', command);
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
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
});

// Communication with content script (message reception handler)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle debug mode status request
  if (message.action === 'getDebugMode') {
    sendResponse({ debugMode: DEBUG_MODE });
    return true; // Return true for async response
  }

  // Handle COLORS info request from content.js
  if (message.action === 'getColors') {
    debugLog('Content script requested COLORS.');
    sendResponse({ colors: COLORS }); // Send COLORS information
    return true; // Return true for async response
  }

  // Handle highlight information request from content.js
  if (message.action === 'getHighlights') {
    // Get highlight information for current URL
    chrome.storage.local.get([message.url], (result) => {
      debugLog('Sending highlights for URL:', message.url, result[message.url] || []);
      sendResponse({ highlights: result[message.url] || [] });
    });
    return true; // Return true for async response
  }

  // Handle highlight information save request from content.js
  if (message.action === 'saveHighlights') {
    // Save highlight information for current URL
    // Save page title together
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      const saveData = {};
      saveData[message.url] = message.highlights;

      // Save metadata together (only if highlights exist)
      if (message.highlights.length > 0) {
        // Check if existing metadata exists
        chrome.storage.local.get([`${message.url}_meta`], (result) => {
          const metaData = result[`${message.url}_meta`] || {};
          metaData.title = currentTab.title;
          metaData.lastUpdated = new Date().toISOString();

          const metaSaveData = {};
          metaSaveData[`${message.url}_meta`] = metaData;

          chrome.storage.local.set(metaSaveData, () => {
            debugLog('Saved page metadata:', metaData);
          });
        });
      } else {
        // If no highlights remain, remove metadata (optional)
        chrome.storage.local.remove([`${message.url}_meta`], () => {
          debugLog('Removed page metadata as no highlights remain:', message.url);
        });
      }

      debugLog('Saving highlights for URL:', message.url, message.highlights);
      chrome.storage.local.set(saveData, () => {
        sendResponse({ success: true });
      });
    });
    return true; // Return true for async response
  }

  // 새로운 핸들러 추가: 하이라이트 삭제를 처리
  if (message.action === 'deleteHighlight') {
    const { url, highlightId } = message;

    chrome.storage.local.get([url], (result) => {
      const highlights = result[url] || [];
      const updatedHighlights = highlights.filter(h => h.id !== highlightId);

      const saveData = {};
      saveData[url] = updatedHighlights;

      chrome.storage.local.set(saveData, () => {
        debugLog('Highlight deleted:', highlightId, 'from URL:', url);

        // 하이라이트가 삭제된 후 content script에 알림
        if (message.notifyRefresh) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id) {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: 'refreshHighlights',
                highlights: updatedHighlights
              });
            }
          });
        }

        sendResponse({
          success: true,
          highlights: updatedHighlights
        });
      });
    });
    return true; // Return true for async response
  }

  // 새로운 핸들러 추가: 모든 하이라이트 삭제
  if (message.action === 'clearAllHighlights') {
    const { url } = message;

    const saveData = {};
    saveData[url] = [];

    chrome.storage.local.set(saveData, () => {
      debugLog('All highlights cleared for URL:', url);

      // 모든 하이라이트가 삭제된 후 content script에 알림
      if (message.notifyRefresh) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'refreshHighlights',
              highlights: []
            });
          }
        });
      }

      sendResponse({ success: true });
    });
    return true; // Return true for async response
  }
});
