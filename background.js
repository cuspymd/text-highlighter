import { browserAPI } from './shared/browser-api.js';
import { DEBUG_MODE, debugLog } from './shared/logger.js';
import {
  initializePlatform,
  loadCustomColors,
  createOrUpdateContextMenus,
  applySettingsFromSync,
} from './background/settings-service.js';
import { initContextMenus } from './background/context-menu.js';
import { registerMessageRouter } from './background/message-router.js';
import { initSyncListener, migrateLocalToSync, getSettingsMissingLocally } from './background/sync-service.js';
import { initCloudSyncAlarm, runCloudSync } from './background/cloud-sync-service.js';
import { openGuideOnInstall } from './background/onboarding.js';

// ===================================================================
// Top-level listener registration
// Service worker may restart at any time; listeners must be registered
// synchronously at the top level to avoid event loss on restart.
// ===================================================================

registerMessageRouter();

initContextMenus();

initSyncListener({
  onSettingsChanged: async (newSettings) => {
    await applySettingsFromSync(newSettings);
  },
});

initCloudSyncAlarm();

browserAPI.runtime.onInstalled.addListener(async (details) => {
  if (DEBUG_MODE) console.log('Extension installed/updated. Debug mode:', DEBUG_MODE);
  await openGuideOnInstall(details);
});

// ===================================================================
// Async initialization
// ===================================================================

// A setting another device chose before this one upgraded is already sitting in
// sync, so no change event will ever announce it. Adopting it at startup is
// what puts it in front of the settings page and the content scripts, which
// read local storage and would otherwise show the setting as off forever.
async function adoptSettingsMissingLocally() {
  const missing = await getSettingsMissingLocally();
  if (!missing) return;

  debugLog('Adopting settings this device had never been told about:', missing);
  await applySettingsFromSync(missing);
}

// The first-run migration writes what sync holds to local storage, after the
// colours, the hide-defaults flag and the shortcut map have been loaded into
// memory and the context menu built from them. Applying the merged settings is
// what brings those up to date; nothing else will until the worker restarts.
async function adoptMigratedSettings() {
  const migrated = await migrateLocalToSync();
  if (!migrated) return;

  await applySettingsFromSync(migrated);
}

(async () => {
  try {
    await initializePlatform();
    await loadCustomColors();
    await createOrUpdateContextMenus();
    await adoptMigratedSettings();
    await adoptSettingsMissingLocally();
    runCloudSync().catch(e => console.error('Initial cloud sync failed', e));
  } catch (e) {
    console.error('Initialization error in background script', e);
  }
})();
