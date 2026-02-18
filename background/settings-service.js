import { browserAPI } from '../shared/browser-api.js';
import { debugLog } from '../shared/logger.js';
import { broadcastToAllTabs } from '../shared/tab-broadcast.js';
import { STORAGE_KEYS, SYNC_KEYS } from '../constants/storage-keys.js';
import { saveSettingsToSync } from './sync-service.js';

const COLORS = [
  { id: 'yellow', nameKey: 'yellowColor', color: '#FFFF00' },
  { id: 'green',  nameKey: 'greenColor',  color: '#AAFFAA' },
  { id: 'blue',   nameKey: 'blueColor',   color: '#AAAAFF' },
  { id: 'pink',   nameKey: 'pinkColor',   color: '#FFAAFF' },
  { id: 'orange', nameKey: 'orangeColor', color: '#FFAA55' },
];

let currentColors = [...COLORS];
let platformInfo = { os: 'unknown' };
let storedShortcuts = {};

function getMessage(key) {
  return browserAPI.i18n.getMessage(key);
}

export async function initializePlatform() {
  try {
    platformInfo = await browserAPI.runtime.getPlatformInfo();
    debugLog('Platform detected:', platformInfo);
  } catch (e) {
    debugLog('Platform detection failed:', e);
  }
}

export function isMobile() {
  return platformInfo.os === 'android';
}

export function getPlatformInfo() {
  return { platform: platformInfo, isMobile: isMobile() };
}

export function getCurrentColors() {
  return currentColors;
}

export function getStoredShortcuts() {
  return storedShortcuts;
}

export async function getCurrentShortcuts() {
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

export async function createOrUpdateContextMenus() {
  if (isMobile() || !browserAPI.contextMenus) return;
  debugLog('Creating/updating context menus...');

  try {
    await browserAPI.contextMenus.removeAll();
  } catch (error) {
    debugLog('Error removing context menus:', error);
    return;
  }

  try {
    await browserAPI.contextMenus.create({
      id: 'highlight-text',
      title: getMessage('highlightText'),
      contexts: ['selection'],
    });
  } catch (error) {
    if (!error.message.includes('duplicate id')) {
      debugLog('Error creating main context menu:', error);
    }
  }

  const commandShortcuts = await getCurrentShortcuts();
  storedShortcuts = { ...commandShortcuts };

  for (const color of currentColors) {
    const commandName = `highlight_${color.id}`;
    const shortcutDisplay = commandShortcuts[commandName] || '';
    const title = color.colorNumber
      ? `${getMessage(color.nameKey)} ${color.colorNumber}${shortcutDisplay}`
      : `${getMessage(color.nameKey)}${shortcutDisplay}`;

    try {
      await browserAPI.contextMenus.create({
        id: `highlight-${color.id}`,
        parentId: 'highlight-text',
        title,
        contexts: ['selection'],
      });
    } catch (error) {
      if (!error.message.includes('duplicate id')) {
        debugLog('Error creating color context menu:', error);
      }
    }
  }

  debugLog('Context menus created with shortcuts:', storedShortcuts);
}

export async function loadCustomColors() {
  try {
    let customColors = [];
    try {
      const syncResult = await browserAPI.storage.sync.get(SYNC_KEYS.SETTINGS);
      if (syncResult[SYNC_KEYS.SETTINGS] && syncResult[SYNC_KEYS.SETTINGS].customColors) {
        customColors = syncResult[SYNC_KEYS.SETTINGS].customColors;
        await browserAPI.storage.local.set({ customColors });
        debugLog('Loaded custom colors from storage.sync');
      }
    } catch (e) {
      debugLog('Failed to read sync settings, falling back to local:', e.message);
    }

    if (customColors.length === 0) {
      const result = await browserAPI.storage.local.get([STORAGE_KEYS.CUSTOM_COLORS]);
      customColors = result.customColors || [];
    }

    let needsUpdate = false;
    customColors.forEach((c, index) => {
      if (!c.colorNumber) {
        c.colorNumber = index + 1;
        needsUpdate = true;
      }
      if (!currentColors.some(existing => existing.color.toLowerCase() === c.color.toLowerCase())) {
        currentColors.push(c);
      }
    });

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

/**
 * Add a new custom color.
 * @returns {{ exists: boolean, colors: object[] }}
 */
export async function addCustomColor(newColorValue) {
  if (!newColorValue) return { exists: true, colors: currentColors };

  const stored = await browserAPI.storage.local.get([STORAGE_KEYS.CUSTOM_COLORS]);
  let customColors = stored.customColors || [];

  const exists = [...currentColors, ...customColors].some(
    c => c.color.toLowerCase() === newColorValue.toLowerCase()
  );
  if (exists) return { exists: true, colors: currentColors };

  const existingCustomCount = currentColors.filter(c => c.id.startsWith('custom_')).length;
  const newColorObj = {
    id: `custom_${Date.now()}`,
    nameKey: 'customColor',
    colorNumber: existingCustomCount + 1,
    color: newColorValue,
  };

  customColors.push(newColorObj);
  currentColors.push(newColorObj);
  await browserAPI.storage.local.set({ customColors });
  debugLog('Added custom color:', newColorObj);

  await saveSettingsToSync();
  return { exists: false, colors: currentColors };
}

/**
 * Clear all custom colors.
 * @returns {{ hadColors: boolean, colors: object[] }}
 */
export async function clearCustomColors() {
  const result = await browserAPI.storage.local.get([STORAGE_KEYS.CUSTOM_COLORS]);
  const customColors = result.customColors || [];

  if (customColors.length === 0) {
    debugLog('No custom colors to clear');
    return { hadColors: false, colors: currentColors };
  }

  await browserAPI.storage.local.set({ customColors: [] });
  currentColors = currentColors.filter(c => !c.id.startsWith('custom_'));
  debugLog('Cleared all custom colors');

  await saveSettingsToSync();
  return { hadColors: true, colors: currentColors };
}

export async function broadcastSettingsToTabs(changedSettings) {
  if (!changedSettings || Object.keys(changedSettings).length === 0) return;

  const tabs = await browserAPI.tabs.query({});
  for (const tab of tabs) {
    try {
      if (changedSettings.minimapVisible !== undefined) {
        await browserAPI.tabs.sendMessage(tab.id, {
          action: 'setMinimapVisibility',
          visible: changedSettings.minimapVisible,
        });
      }
      if (changedSettings.selectionControlsVisible !== undefined) {
        await browserAPI.tabs.sendMessage(tab.id, {
          action: 'setSelectionControlsVisibility',
          visible: changedSettings.selectionControlsVisible,
        });
      }
    } catch (e) {
      // Some tabs may not have content script injected.
    }
  }
}

/**
 * Apply settings received from sync storage on another device.
 * @returns {{ colorsChanged: boolean }}
 */
export async function applySettingsFromSync(newSettings) {
  let colorsChanged = false;

  if (newSettings.customColors) {
    await browserAPI.storage.local.set({ customColors: newSettings.customColors });
    currentColors = [...COLORS];
    newSettings.customColors.forEach(c => {
      if (!currentColors.some(existing => existing.color.toLowerCase() === c.color.toLowerCase())) {
        currentColors.push(c);
      }
    });
    await broadcastToAllTabs({ action: 'colorsUpdated', colors: currentColors });
    colorsChanged = true;
  }

  if (newSettings.minimapVisible !== undefined) {
    await browserAPI.storage.local.set({ minimapVisible: newSettings.minimapVisible });
    await broadcastToAllTabs({ action: 'setMinimapVisibility', visible: newSettings.minimapVisible });
  }

  if (newSettings.selectionControlsVisible !== undefined) {
    await browserAPI.storage.local.set({ selectionControlsVisible: newSettings.selectionControlsVisible });
    await broadcastToAllTabs({ action: 'setSelectionControlsVisibility', visible: newSettings.selectionControlsVisible });
  }

  return { colorsChanged };
}
