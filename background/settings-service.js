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

const DEFAULT_SHORTCUT_COLOR_MAP = {
  command_slot_1: 'yellow',
  command_slot_2:  'green',
  command_slot_3:   'blue',
  command_slot_4:   'pink',
  command_slot_5: 'orange',
};

let currentColors = [...COLORS];
let platformInfo = { os: 'unknown' };
let storedShortcuts = {};
let shortcutColorMap = { ...DEFAULT_SHORTCUT_COLOR_MAP };
let hasLoadedCustomColors = false;
let customColorsLoadInFlight = null;

function isValidCustomColorNumber(value) {
  return Number.isInteger(value) && value > 0;
}

function normalizeCustomColorNumbers(customColors) {
  const usedNumbers = new Set();
  let maxNumber = 0;
  let needsUpdate = false;

  customColors.forEach((colorObj) => {
    if (isValidCustomColorNumber(colorObj.colorNumber) && !usedNumbers.has(colorObj.colorNumber)) {
      usedNumbers.add(colorObj.colorNumber);
      maxNumber = Math.max(maxNumber, colorObj.colorNumber);
      return;
    }

    let nextNumber = maxNumber + 1;
    while (usedNumbers.has(nextNumber)) {
      nextNumber += 1;
    }

    colorObj.colorNumber = nextNumber;
    usedNumbers.add(nextNumber);
    maxNumber = nextNumber;
    needsUpdate = true;
  });

  return { maxNumber, needsUpdate };
}

function getMessage(key) {
  return browserAPI.i18n.getMessage(key);
}

function getCustomColorBaseName() {
  return getMessage('customColor') || 'Custom Color';
}

function isCustomColor(color) {
  return color && typeof color.id === 'string' && color.id.startsWith('custom_');
}

function getColorDisplayName(color) {
  if (color.customName) return color.customName;

  if (isCustomColor(color)) {
    const baseName = getCustomColorBaseName();
    return color.colorNumber ? `${baseName} ${color.colorNumber}` : baseName;
  }

  if (color.nameKey) {
    return getMessage(color.nameKey) || color.nameKey;
  }

  return color.color || '';
}

function sanitizeCustomColors(customColors) {
  let needsUpdate = false;

  customColors.forEach((colorObj) => {
    if (Object.prototype.hasOwnProperty.call(colorObj, 'nameKey')) {
      delete colorObj.nameKey;
      needsUpdate = true;
    }
  });

  const normalized = normalizeCustomColorNumbers(customColors);
  return { ...normalized, needsUpdate: needsUpdate || normalized.needsUpdate };
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

export function getShortcutColorMap() {
  return shortcutColorMap;
}

export async function saveShortcutColorMap(newMap) {
  shortcutColorMap = { ...newMap };
  await browserAPI.storage.local.set({ [STORAGE_KEYS.SHORTCUT_COLOR_MAP]: shortcutColorMap });
  await saveSettingsToSync();
}

async function loadShortcutColorMap() {
  const result = await browserAPI.storage.local.get([STORAGE_KEYS.SHORTCUT_COLOR_MAP]);
  shortcutColorMap = result[STORAGE_KEYS.SHORTCUT_COLOR_MAP] || { ...DEFAULT_SHORTCUT_COLOR_MAP };
}

export async function getCurrentShortcuts() {
  if (!browserAPI.commands) return {};
  const commands = await browserAPI.commands.getAll();
  const shortcuts = {};
  commands.forEach(command => {
    if (command.name.startsWith('command_') && command.shortcut) {
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
    const slotName = Object.keys(shortcutColorMap).find(key => shortcutColorMap[key] === color.id);
    const shortcutDisplay = (slotName && commandShortcuts[slotName]) || '';

    let title;
    if (color.customName) {
      title = `${color.customName}${shortcutDisplay}`;
    } else {
      title = `${getColorDisplayName(color)}${shortcutDisplay}`;
    }

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

async function loadCustomColorsFromStorage() {
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

  const { needsUpdate } = sanitizeCustomColors(customColors);
  currentColors = [...COLORS];
  customColors.forEach((c) => {
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

  await loadShortcutColorMap();
}

export async function loadCustomColors() {
  if (hasLoadedCustomColors) return;
  if (customColorsLoadInFlight) {
    await customColorsLoadInFlight;
    return;
  }

  customColorsLoadInFlight = (async () => {
    try {
      await loadCustomColorsFromStorage();
      hasLoadedCustomColors = true;
    } catch (e) {
      console.error('Error loading custom colors', e);
      throw e;
    } finally {
      customColorsLoadInFlight = null;
    }
  })();

  await customColorsLoadInFlight;
}

export async function ensureCustomColorsLoaded() {
  if (hasLoadedCustomColors) return;
  await loadCustomColors();
}

export async function updateCustomColorName(id, newName) {
  const stored = await browserAPI.storage.local.get([STORAGE_KEYS.CUSTOM_COLORS]);
  const customColors = stored.customColors || [];

  const idx = customColors.findIndex(c => c.id === id);
  if (idx === -1) return { notFound: true, colors: currentColors };

  // Check for duplicates in custom names or generated default names
  const duplicate = [...COLORS, ...customColors].some((c) => {
    if (c.id === id) return false;
    const currentName = getColorDisplayName(c);
    return currentName.toLowerCase() === newName.toLowerCase();
  });

  if (duplicate) return { exists: true, colors: currentColors };

  const finalName = newName.substring(0, 50);

  customColors[idx] = { ...customColors[idx], customName: finalName };
  await browserAPI.storage.local.set({ customColors });

  const globalIdx = currentColors.findIndex(c => c.id === id);
  if (globalIdx !== -1) currentColors[globalIdx] = { ...currentColors[globalIdx], customName: finalName };

  await saveSettingsToSync();
  return { exists: false, colors: currentColors };
}

export async function updateCustomColor(id, newColorValue) {
  const stored = await browserAPI.storage.local.get([STORAGE_KEYS.CUSTOM_COLORS]);
  const customColors = stored.customColors || [];

  const idx = customColors.findIndex(c => c.id === id);
  if (idx === -1) return { notFound: true, colors: currentColors };

  // Check for duplicates
  const duplicate = [...COLORS, ...customColors].some(
    (c, i) => c.color.toLowerCase() === newColorValue.toLowerCase() && c.id !== id
  );
  if (duplicate) return { exists: true, colors: currentColors };

  customColors[idx] = { ...customColors[idx], color: newColorValue };
  await browserAPI.storage.local.set({ customColors });

  const globalIdx = currentColors.findIndex(c => c.id === id);
  if (globalIdx !== -1) currentColors[globalIdx] = { ...currentColors[globalIdx], color: newColorValue };

  await saveSettingsToSync();
  return { exists: false, colors: currentColors };
}

export async function removeCustomColor(id) {
  const stored = await browserAPI.storage.local.get([STORAGE_KEYS.CUSTOM_COLORS]);
  let customColors = stored.customColors || [];

  const before = customColors.length;
  customColors = customColors.filter(c => c.id !== id);
  if (customColors.length === before) return { notFound: true, colors: currentColors };

  await browserAPI.storage.local.set({ customColors });
  currentColors = currentColors.filter(c => c.id !== id);

  await saveSettingsToSync();
  return { colors: currentColors };
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

  const { maxNumber } = normalizeCustomColorNumbers(customColors);
  const newColorObj = {
    id: `custom_${Date.now()}`,
    colorNumber: maxNumber + 1,
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
    const customColors = newSettings.customColors.map(color => ({ ...color }));
    sanitizeCustomColors(customColors);
    await browserAPI.storage.local.set({ customColors });
    currentColors = [...COLORS];
    customColors.forEach(c => {
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

  if (newSettings.shortcutColorMap) {
    await browserAPI.storage.local.set({ [STORAGE_KEYS.SHORTCUT_COLOR_MAP]: newSettings.shortcutColorMap });
    shortcutColorMap = newSettings.shortcutColorMap;
  }

  return { colorsChanged };
}
