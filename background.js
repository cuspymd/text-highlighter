import { browserAPI } from './shared/browser-api.js';
import { DEBUG_MODE } from './shared/logger.js';
import {
  initializePlatform,
  loadCustomColors,
  createOrUpdateContextMenus,
  applySettingsFromSync,
} from './background/settings-service.js';
import { initContextMenus } from './background/context-menu.js';
import { registerMessageRouter } from './background/message-router.js';
import { initSyncListener, migrateLocalToSync } from './background/sync-service.js';

// ===================================================================
// Top-level listener registration
// Service worker may restart at any time; listeners must be registered
// synchronously at the top level to avoid event loss on restart.
// ===================================================================

registerMessageRouter();

initContextMenus();

initSyncListener({
  onSettingsChanged: async (newSettings) => {
    const { colorsChanged } = await applySettingsFromSync(newSettings);
    if (colorsChanged) {
      await createOrUpdateContextMenus();
    }
  },
});

browserAPI.runtime.onInstalled.addListener(async () => {
  if (DEBUG_MODE) console.log('Extension installed/updated. Debug mode:', DEBUG_MODE);
});

// ===================================================================
// Async initialization
// ===================================================================

(async () => {
  try {
    await initializePlatform();
    await loadCustomColors();
    await createOrUpdateContextMenus();
    await migrateLocalToSync();
  } catch (e) {
    console.error('Initialization error in background script', e);
  }
})();
