import { browserAPI } from './shared/browser-api.js';
import { initializeThemeWatcher } from './shared/theme.js';
import { createLocalizedModalHelpers } from './shared/modal.js';

const SLOT_COMMANDS = ['highlight_yellow', 'highlight_green', 'highlight_blue', 'highlight_pink', 'highlight_orange'];

function initializeI18n() {
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n');
    const message = browserAPI.i18n.getMessage(key);
    if (!message) return;
    if (element.tagName === 'TITLE') {
      element.textContent = message;
      return;
    }
    element.textContent = message;
  });
}

const { showAlertModal } = createLocalizedModalHelpers((key, defaultValue) => browserAPI.i18n.getMessage(key) || defaultValue);

function getColorLabel(color) {
  const base = browserAPI.i18n.getMessage(color.nameKey) || color.id;
  return color.colorNumber ? `${base} ${color.colorNumber}` : base;
}

async function loadGeneralSettings() {
  const minimapToggle = document.getElementById('minimap-toggle');
  const selectionControlsToggle = document.getElementById('selection-controls-toggle');
  const selectionControlsRow = document.getElementById('selection-controls-row');

  const result = await browserAPI.storage.local.get(['minimapVisible', 'selectionControlsVisible']);
  minimapToggle.checked = result.minimapVisible !== undefined ? result.minimapVisible : true;

  if (!browserAPI.windows) {
    selectionControlsRow.style.display = 'none';
  } else {
    selectionControlsToggle.checked = result.selectionControlsVisible !== undefined ? result.selectionControlsVisible : true;
  }

  minimapToggle.addEventListener('change', async () => {
    await browserAPI.runtime.sendMessage({ action: 'saveSettings', minimapVisible: minimapToggle.checked });
  });

  selectionControlsToggle.addEventListener('change', async () => {
    await browserAPI.runtime.sendMessage({ action: 'saveSettings', selectionControlsVisible: selectionControlsToggle.checked });
  });
}

async function fetchAllColors() {
  const response = await browserAPI.runtime.sendMessage({ action: 'getColors' });
  return response.colors || [];
}

async function loadCustomColors() {
  const allColors = await fetchAllColors();
  const customColors = allColors.filter((c) => c.id.startsWith('custom_'));
  renderCustomColorsList(customColors);
}

function renderCustomColorsList(customColors) {
  const list = document.getElementById('custom-colors-list');
  list.innerHTML = '';

  if (customColors.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = browserAPI.i18n.getMessage('noCustomColors');
    list.appendChild(empty);
    return;
  }

  customColors.forEach((colorObj) => {
    const row = document.createElement('div');
    row.className = 'settings-row';

    const left = document.createElement('div');
    left.className = 'label';

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.backgroundColor = colorObj.color;

    const text = document.createElement('span');
    text.textContent = `${getColorLabel(colorObj)} ${colorObj.color}`;

    left.append(swatch, text);

    const actions = document.createElement('div');

    const editBtn = document.createElement('button');
    editBtn.className = 'btn';
    editBtn.textContent = browserAPI.i18n.getMessage('editColor');
    editBtn.addEventListener('click', () => handleUpdateColor(colorObj));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn';
    removeBtn.textContent = browserAPI.i18n.getMessage('removeColor');
    removeBtn.addEventListener('click', () => handleRemoveColor(colorObj));

    actions.append(editBtn, removeBtn);
    row.append(left, actions);
    list.appendChild(row);
  });
}

function openColorPicker(initialValue, onChange) {
  const picker = document.getElementById('color-picker-hidden');
  picker.value = initialValue;
  picker.onchange = async () => {
    await onChange(picker.value);
    picker.onchange = null;
  };
  picker.click();
}

async function handleUpdateColor(colorObj) {
  openColorPicker(colorObj.color, async (value) => {
    const response = await browserAPI.runtime.sendMessage({ action: 'updateCustomColor', id: colorObj.id, color: value });
    if (response.success) {
      await loadCustomColors();
      await loadShortcuts();
    } else if (response.exists) {
      await showAlertModal(browserAPI.i18n.getMessage('colorAlreadyExists'));
    }
  });
}

async function handleRemoveColor(colorObj) {
  const response = await browserAPI.runtime.sendMessage({ action: 'removeCustomColor', id: colorObj.id });
  if (response.success) {
    await loadCustomColors();
    await loadShortcuts();
  }
}

function bindAddCustomColor() {
  document.getElementById('add-custom-color-btn').addEventListener('click', () => {
    openColorPicker('#ff0000', async (value) => {
      const response = await browserAPI.runtime.sendMessage({ action: 'addColor', color: value });
      if (response.success && !response.exists) {
        await loadCustomColors();
        await loadShortcuts();
      } else if (response.exists) {
        await showAlertModal(browserAPI.i18n.getMessage('colorAlreadyExists'));
      }
    });
  });
}

async function loadShortcuts() {
  const [commands, mapResponse, colorsResponse] = await Promise.all([
    browserAPI.commands ? browserAPI.commands.getAll() : Promise.resolve([]),
    browserAPI.runtime.sendMessage({ action: 'getShortcutColorMap' }),
    browserAPI.runtime.sendMessage({ action: 'getColors' }),
  ]);

  renderShortcutsList(commands, mapResponse.shortcutColorMap || {}, colorsResponse.colors || []);
}

function renderShortcutsList(commands, colorMap, allColors) {
  const list = document.getElementById('shortcuts-list');
  list.innerHTML = '';

  SLOT_COMMANDS.forEach((cmdName, idx) => {
    const cmd = commands.find((c) => c.name === cmdName);
    const shortcutLabel = cmd?.shortcut || browserAPI.i18n.getMessage('notAssigned');
    const assignedColorId = colorMap[cmdName] ?? '';

    const row = document.createElement('div');
    row.className = 'shortcut-row';

    const label = document.createElement('span');
    label.textContent = `${browserAPI.i18n.getMessage('shortcutSlot')} ${idx + 1} · ${shortcutLabel}`;

    const select = document.createElement('select');
    const none = document.createElement('option');
    none.value = '';
    none.textContent = browserAPI.i18n.getMessage('notAssigned');
    select.appendChild(none);

    allColors.forEach((color) => {
      const option = document.createElement('option');
      option.value = color.id;
      option.textContent = getColorLabel(color);
      if (color.id === assignedColorId) option.selected = true;
      select.appendChild(option);
    });

    select.addEventListener('change', async () => {
      const updatedMap = { ...colorMap, [cmdName]: select.value || null };
      const response = await browserAPI.runtime.sendMessage({ action: 'saveShortcutColorMap', shortcutColorMap: updatedMap });
      if (response.success) colorMap[cmdName] = select.value || null;
    });

    row.append(label, select);
    list.appendChild(row);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  initializeI18n();
  initializeThemeWatcher();
  await loadGeneralSettings();
  bindAddCustomColor();
  await loadCustomColors();
  await loadShortcuts();
});
