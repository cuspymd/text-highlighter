import { browserAPI } from '../shared/browser-api.js';
import { debugLog } from '../shared/logger.js';
import { sendMessageToTab } from '../shared/tab-broadcast.js';
import {
  isMobile,
  getCurrentColors,
  createOrUpdateContextMenus,
  ensureCustomColorsLoaded,
  getShortcutColorMap,
} from './settings-service.js';

// Shortcut commands that move between highlights, and the direction each sends.
const NAVIGATION_COMMANDS = {
  navigate_next_highlight: 'next',
  navigate_previous_highlight: 'previous',
};

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
          const response = await sendMessageToTab(tab.id, {
            action: 'highlight',
            color: color.color,
            text: info.selectionText,
          });
          debugLog('Highlight action response:', response);
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
        if (NAVIGATION_COMMANDS[command]) {
          await sendMessageToTab(activeTab.id, {
            action: 'jumpToAdjacentHighlight',
            direction: NAVIGATION_COMMANDS[command],
          });
          return;
        }
        if (command.startsWith('command_slot_')) {
          const colorMap = getShortcutColorMap();
          const colorId = colorMap[command] ?? null;
          targetColor = colorId ? getCurrentColors().find(c => c.id === colorId)?.color : null;
        }

        if (targetColor) {
          debugLog('Sending highlight action to tab:', activeTab.id, 'with color:', targetColor);
          const response = await sendMessageToTab(activeTab.id, {
            action: 'highlight',
            color: targetColor,
          });
          debugLog('Highlight action response:', response);
        }
      }
    });
  }

  // A shortcut changed on the browser's shortcut page fires no event, so the
  // menu's shortcut labels are brought up to date on tab activation. The
  // rebuild compares what it would build with what it last built, and does
  // nothing when they match - which is nearly always.
  browserAPI.tabs.onActivated.addListener(async () => {
    if (isMobile() || !browserAPI.commands) return;
    // A background this tab switch woke has not loaded the custom colours yet.
    // Built from the defaults it starts with, the menu would differ from the
    // last one and be rebuilt - twice, once more when the load lands.
    try {
      await ensureCustomColorsLoaded();
    } catch (error) {
      debugLog('Custom colours could not be loaded before checking the menu:', error);
    }
    await createOrUpdateContextMenus();
  });
}
