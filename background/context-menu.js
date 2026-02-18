import { browserAPI } from '../shared/browser-api.js';
import { debugLog } from '../shared/logger.js';
import {
  isMobile,
  getCurrentColors,
  getCurrentShortcuts,
  getStoredShortcuts,
  createOrUpdateContextMenus,
} from './settings-service.js';

/**
 * Register context menu, shortcut, and tab activation listeners.
 * Call once at service worker startup.
 */
export function initContextMenus() {
  // Context menu click handler (desktop only)
  if (browserAPI.contextMenus) {
    browserAPI.contextMenus.onClicked.addListener(async (info, tab) => {
      const menuId = info.menuItemId;
      debugLog('Context menu clicked:', menuId);

      if (menuId.startsWith('highlight-') && menuId !== 'highlight-text') {
        const colorId = menuId.replace('highlight-', '');
        const color = getCurrentColors().find(c => c.id === colorId);

        if (color) {
          debugLog('Sending highlight action to tab:', tab.id);
          try {
            const response = await browserAPI.tabs.sendMessage(tab.id, {
              action: 'highlight',
              color: color.color,
              text: info.selectionText,
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
        switch (command) {
          case 'highlight_yellow': targetColor = getCurrentColors().find(c => c.id === 'yellow')?.color; break;
          case 'highlight_green':  targetColor = getCurrentColors().find(c => c.id === 'green')?.color;  break;
          case 'highlight_blue':   targetColor = getCurrentColors().find(c => c.id === 'blue')?.color;   break;
          case 'highlight_pink':   targetColor = getCurrentColors().find(c => c.id === 'pink')?.color;   break;
          case 'highlight_orange': targetColor = getCurrentColors().find(c => c.id === 'orange')?.color; break;
        }

        if (targetColor) {
          debugLog('Sending highlight action to tab:', activeTab.id, 'with color:', targetColor);
          try {
            const response = await browserAPI.tabs.sendMessage(activeTab.id, {
              action: 'highlight',
              color: targetColor,
            });
            debugLog('Highlight action response:', response);
          } catch (error) {
            debugLog('Error sending highlight action:', error);
          }
        }
      }
    });
  }

  // Shortcut change detection on tab activation
  browserAPI.tabs.onActivated.addListener(async () => {
    if (isMobile() || !browserAPI.commands) return;

    const currentShortcuts = await getCurrentShortcuts();
    const stored = getStoredShortcuts();
    let hasChanged = false;

    for (const commandName in currentShortcuts) {
      if (stored[commandName] !== currentShortcuts[commandName]) {
        hasChanged = true;
        break;
      }
    }

    if (!hasChanged) {
      for (const commandName in stored) {
        if (!currentShortcuts[commandName]) {
          hasChanged = true;
          break;
        }
      }
    }

    if (hasChanged) {
      debugLog('Shortcut changes detected, updating context menus');
      await createOrUpdateContextMenus();
    }
  });
}
