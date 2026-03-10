import { browserAPI } from './shared/browser-api.js';
import { debugLog } from './shared/logger.js';
import { createLocalizedModalHelpers } from './shared/modal.js';
import { initializeThemeWatcher } from './shared/theme.js';

function initializeI18n() {
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(element => {
    const key = element.getAttribute('data-i18n');
    const message = browserAPI.i18n.getMessage(key);
    if (message) {
      if (element.tagName === 'INPUT' && element.type === 'button') {
        element.value = message;
      } else if (element.tagName === 'INPUT' && element.placeholder !== undefined) {
        element.placeholder = message;
      } else if (element.tagName === 'TITLE') {
        element.textContent = message;
      } else {
        element.textContent = message;
      }
    }
  });
}

const { showAlertModal } = createLocalizedModalHelpers(
  (key, defaultValue) => browserAPI.i18n.getMessage(key) || defaultValue
);

document.addEventListener('DOMContentLoaded', async () => {
  initializeI18n();
  initializeThemeWatcher();

  // --- General Settings ---
  const minimapToggle = document.getElementById('minimap-toggle');
  const selectionControlsToggle = document.getElementById('selection-controls-toggle');
  const selectionControlsRow = document.getElementById('selection-controls-row');

  async function loadGeneralSettings() {
    const result = await browserAPI.storage.local.get(['minimapVisible', 'selectionControlsVisible']);

    const minimapVisible = result.minimapVisible !== undefined ? result.minimapVisible : true;
    minimapToggle.checked = minimapVisible;

    if (!browserAPI.windows) {
      selectionControlsRow.style.display = 'none';
    } else {
      const selectionControlsVisible = result.selectionControlsVisible !== undefined ? result.selectionControlsVisible : true;
      selectionControlsToggle.checked = selectionControlsVisible;
    }
  }

  minimapToggle.addEventListener('change', async () => {
    await browserAPI.runtime.sendMessage({
      action: 'saveSettings',
      minimapVisible: minimapToggle.checked
    });
  });

  selectionControlsToggle.addEventListener('change', async () => {
    await browserAPI.runtime.sendMessage({
      action: 'saveSettings',
      selectionControlsVisible: selectionControlsToggle.checked
    });
  });

  // --- Custom Colors ---
  const customColorsList = document.getElementById('custom-colors-list');
  const addCustomColorBtn = document.getElementById('add-custom-color-btn');
  const colorPicker = document.getElementById('color-picker-hidden');

  let activeColorIdForUpdate = null;

  function buildColorRow(colorObj) {
    const row = document.createElement('div');
    row.className = 'color-row';

    const info = document.createElement('div');
    info.className = 'color-info';

    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = colorObj.color;

    const name = document.createElement('span');
    name.className = 'color-name';
    name.textContent = `${browserAPI.i18n.getMessage('customColor') || 'Custom Color'} ${colorObj.colorNumber}`;

    const hex = document.createElement('span');
    hex.className = 'color-hex';
    hex.textContent = colorObj.color.toUpperCase();

    info.appendChild(swatch);
    info.appendChild(name);
    info.appendChild(hex);

    const actions = document.createElement('div');
    actions.className = 'color-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-icon';
    editBtn.textContent = browserAPI.i18n.getMessage('editColor') || 'Edit';
    editBtn.addEventListener('click', () => {
      activeColorIdForUpdate = colorObj.id;
      colorPicker.value = colorObj.color;
      colorPicker.click();
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-icon btn-danger';
    removeBtn.textContent = browserAPI.i18n.getMessage('removeColor') || 'Remove';
    removeBtn.addEventListener('click', async () => {
      await handleRemoveColor(colorObj);
    });

    actions.appendChild(editBtn);
    actions.appendChild(removeBtn);

    row.appendChild(info);
    row.appendChild(actions);

    return row;
  }

  function renderCustomColorsList(customColors) {
    customColorsList.innerHTML = '';

    if (customColors.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-text';
      empty.textContent = browserAPI.i18n.getMessage('noCustomColors') || 'No custom colors yet.';
      customColorsList.appendChild(empty);
      return;
    }

    customColors.forEach(colorObj => {
      customColorsList.appendChild(buildColorRow(colorObj));
    });
  }

  colorPicker.addEventListener('change', async () => {
    const colorValue = colorPicker.value;

    if (activeColorIdForUpdate) {
      // Update
      const response = await browserAPI.runtime.sendMessage({
        action: 'updateCustomColor',
        id: activeColorIdForUpdate,
        color: colorValue
      });
      activeColorIdForUpdate = null;

      if (response.success) {
        if (response.exists) {
          await showAlertModal(browserAPI.i18n.getMessage('colorAlreadyExists') || 'Color already exists.');
        } else {
          const customColors = response.colors.filter(c => c.id.startsWith('custom_'));
          renderCustomColorsList(customColors);
          await loadShortcuts(); // Refresh names in dropdown
        }
      }
    } else {
      // Add
      const response = await browserAPI.runtime.sendMessage({
        action: 'addColor',
        color: colorValue
      });
      if (response.success) {
        if (response.exists) {
          await showAlertModal(browserAPI.i18n.getMessage('colorAlreadyExists') || 'Color already exists.');
        } else {
          const customColors = response.colors.filter(c => c.id.startsWith('custom_'));
          renderCustomColorsList(customColors);
          await loadShortcuts(); // Refresh options in dropdown
        }
      }
    }
  });

  addCustomColorBtn.addEventListener('click', () => {
    activeColorIdForUpdate = null;
    colorPicker.value = '#ff0000';
    colorPicker.click();
  });

  async function handleRemoveColor(colorObj) {
    const response = await browserAPI.runtime.sendMessage({
      action: 'removeCustomColor',
      id: colorObj.id
    });
    if (response.success) {
      const customColors = response.colors.filter(c => c.id.startsWith('custom_'));
      renderCustomColorsList(customColors);
      await loadShortcuts(); // Refresh options and remove from map if assigned
    }
  }

  async function loadCustomColors() {
    const response = await browserAPI.runtime.sendMessage({ action: 'getColors' });
    if (response && response.colors) {
      const customColors = response.colors.filter(c => c.id.startsWith('custom_'));
      renderCustomColorsList(customColors);
    }
  }

  // --- Keyboard Shortcuts ---
  const shortcutsList = document.getElementById('shortcuts-list');

  function buildColorLabel(colorObj) {
    if (colorObj.nameKey) {
      const msg = browserAPI.i18n.getMessage(colorObj.nameKey);
      if (colorObj.colorNumber) {
        return `${msg} ${colorObj.colorNumber}`;
      }
      return msg || colorObj.nameKey;
    }
    return colorObj.color;
  }

  async function renderShortcutsList(commands, colorMap, allColors) {
    shortcutsList.innerHTML = '';

    const SLOT_COMMANDS = [
      'command_slot_1', 'command_slot_2', 'command_slot_3',
      'command_slot_4', 'command_slot_5',
    ];

    SLOT_COMMANDS.forEach((cmdName, idx) => {
      const cmd = commands.find(c => c.name === cmdName);
      const shortcutLabel = cmd?.shortcut || browserAPI.i18n.getMessage('notAssigned') || '(Not assigned)';
      const assignedColorId = colorMap[cmdName] ?? null;

      const row = document.createElement('div');
      row.className = 'shortcut-row';

      const info = document.createElement('div');
      info.className = 'shortcut-info';

      const slotLabel = document.createElement('span');
      slotLabel.className = 'shortcut-slot';
      slotLabel.textContent = `${browserAPI.i18n.getMessage('shortcutSlot') || 'Slot'} ${idx + 1}`;

      const keyBadge = document.createElement('span');
      keyBadge.className = 'key-badge';
      keyBadge.textContent = shortcutLabel;

      info.appendChild(slotLabel);
      info.appendChild(keyBadge);

      const select = document.createElement('select');
      select.className = 'shortcut-select';

      const noneOption = document.createElement('option');
      noneOption.value = '';
      noneOption.textContent = browserAPI.i18n.getMessage('notAssigned') || '(Not assigned)';
      select.appendChild(noneOption);

      allColors.forEach(color => {
        const option = document.createElement('option');
        option.value = color.id;
        option.textContent = buildColorLabel(color);
        if (color.id === assignedColorId) option.selected = true;
        select.appendChild(option);
      });

      select.addEventListener('change', async () => {
        const newColorId = select.value || null;
        colorMap[cmdName] = newColorId;

        await browserAPI.runtime.sendMessage({
          action: 'saveShortcutColorMap',
          shortcutColorMap: colorMap
        });
      });

      row.appendChild(info);
      row.appendChild(select);
      shortcutsList.appendChild(row);
    });
  }

  async function loadShortcuts() {
    if (!browserAPI.commands) {
      shortcutsList.innerHTML = '<div class="empty-text">Shortcuts not supported on this platform.</div>';
      return;
    }

    const [commandsResult, colorMapResult, colorsResult] = await Promise.all([
      browserAPI.commands.getAll(),
      browserAPI.runtime.sendMessage({ action: 'getShortcutColorMap' }),
      browserAPI.runtime.sendMessage({ action: 'getColors' })
    ]);

    const colorMap = colorMapResult.success ? colorMapResult.shortcutColorMap : {};
    const allColors = colorsResult.colors || [];

    // Auto-cleanup map if a custom color was removed but still assigned
    let mapChanged = false;
    for (const key in colorMap) {
      if (colorMap[key] && !allColors.find(c => c.id === colorMap[key])) {
        colorMap[key] = null;
        mapChanged = true;
      }
    }
    if (mapChanged) {
      await browserAPI.runtime.sendMessage({
        action: 'saveShortcutColorMap',
        shortcutColorMap: colorMap
      });
    }

    renderShortcutsList(commandsResult, colorMap, allColors);
  }

  // --- Init ---
  if (!browserAPI.commands) {
    document.getElementById('shortcuts-section').style.display = 'none';
  }

  await Promise.all([
    loadGeneralSettings(),
    loadCustomColors(),
    loadShortcuts()
  ]);

  window.addEventListener('focus', async () => {
    await Promise.all([
      loadCustomColors(),
      loadShortcuts()
    ]);
  });
});
