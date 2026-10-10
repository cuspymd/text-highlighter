import { browserAPI } from './shared/browser-api.js';
import { debugLog } from './shared/logger.js';
import { createLocalizedModalHelpers } from './shared/modal.js';
import { sendToBackground } from './shared/runtime-message.js';
import { initializeThemeWatcher } from './shared/theme.js';
import { copyTextToClipboard } from './shared/clipboard.js';

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

const { showAlertModal, showConfirmModal } = createLocalizedModalHelpers(
  (key, defaultValue) => browserAPI.i18n.getMessage(key) || defaultValue
);

document.addEventListener('DOMContentLoaded', async () => {
  initializeI18n();
  initializeThemeWatcher();

  // --- General Settings ---
  const minimapToggle = document.getElementById('minimap-toggle');
  const selectionControlsToggle = document.getElementById('selection-controls-toggle');
  const selectionControlsRow = document.getElementById('selection-controls-row');
  const oneClickToggle = document.getElementById('one-click-highlight-toggle');
  const oneClickRow = document.getElementById('one-click-highlight-row');

  // One-click highlighting rides on the selection icon, so it can do nothing
  // while the icon is switched off. Mobile has no such switch - the icon is
  // always on there - so the row stays live.
  function syncOneClickAvailability() {
    const available = !browserAPI.windows || selectionControlsToggle.checked;
    oneClickToggle.disabled = !available;
    oneClickRow.classList.toggle('is-disabled', !available);
  }

  async function loadGeneralSettings() {
    const result = await browserAPI.storage.local.get([
      'minimapVisible',
      'selectionControlsVisible',
      'oneClickHighlightEnabled',
      'hideDefaultColors',
    ]);

    const minimapVisible = result.minimapVisible !== undefined ? result.minimapVisible : true;
    minimapToggle.checked = minimapVisible;

    if (!browserAPI.windows) {
      selectionControlsRow.style.display = 'none';
    } else {
      const selectionControlsVisible = result.selectionControlsVisible !== undefined ? result.selectionControlsVisible : true;
      selectionControlsToggle.checked = selectionControlsVisible;
    }

    oneClickToggle.checked = result.oneClickHighlightEnabled === true;
    syncOneClickAvailability();

    hideDefaultsToggle.checked = result.hideDefaultColors === true;
    syncHideDefaultsFallback();
  }

  minimapToggle.addEventListener('change', async () => {
    await sendToBackground({
      action: 'saveSettings',
      minimapVisible: minimapToggle.checked
    });
  });

  selectionControlsToggle.addEventListener('change', async () => {
    syncOneClickAvailability();
    await sendToBackground({
      action: 'saveSettings',
      selectionControlsVisible: selectionControlsToggle.checked
    });
  });

  oneClickToggle.addEventListener('change', async () => {
    await sendToBackground({
      action: 'saveSettings',
      oneClickHighlightEnabled: oneClickToggle.checked
    });
  });

  // --- Custom Colors ---
  const customColorsList = document.getElementById('custom-colors-list');
  const addCustomColorBtn = document.getElementById('add-custom-color-btn');
  const clearCustomColorsBtn = document.getElementById('clear-custom-colors-btn');
  const reorderColorsBtn = document.getElementById('reorder-custom-colors-btn');
  const reorderModeLabel = document.getElementById('reorder-mode-label');
  const reorderActions = document.getElementById('reorder-actions');
  const reorderCancelBtn = document.getElementById('reorder-cancel-btn');
  const reorderSaveBtn = document.getElementById('reorder-save-btn');
  const reorderHint = document.getElementById('reorder-hint');
  const reorderSavedStatus = document.getElementById('reorder-saved-status');
  const colorPicker = document.getElementById('color-picker-hidden');
  const hideDefaultsToggle = document.getElementById('hide-default-colors-toggle');
  const hideDefaultsFallback = document.getElementById('hide-default-colors-fallback');
  let customColorCount = null;
  // The custom colours as last rendered, and - while reordering - the order
  // being put together from them, or null outside reorder mode.
  let shownCustomColors = [];
  let reorderDraft = null;

  // Hiding the defaults with no custom colour to show instead would leave the
  // palette empty, so the defaults stay - which looks like the switch is not
  // working unless the page says why.
  function syncHideDefaultsFallback() {
    hideDefaultsFallback.hidden = !(hideDefaultsToggle.checked && customColorCount === 0);
  }

  hideDefaultsToggle.addEventListener('change', async () => {
    syncHideDefaultsFallback();
    await sendToBackground({
      action: 'saveSettings',
      hideDefaultColors: hideDefaultsToggle.checked
    });
  });

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
    name.textContent = colorObj.customName || `${browserAPI.i18n.getMessage('customColor') || 'Custom Color'} ${colorObj.colorNumber}`;
    name.title = browserAPI.i18n.getMessage('editNameTooltip') || 'Click to edit name';

    let isEditingName = false;

    name.addEventListener('click', () => {
      if (isEditingName) return;
      isEditingName = true;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'color-name-input';
      input.maxLength = 50;
      input.value = name.textContent;

      const finishEditing = async () => {
        if (!isEditingName) return;
        isEditingName = false;

        const newName = input.value.trim();
        if (newName && newName !== (colorObj.customName || `${browserAPI.i18n.getMessage('customColor') || 'Custom Color'} ${colorObj.colorNumber}`)) {
          const response = await browserAPI.runtime.sendMessage({
            action: 'updateCustomColorName',
            id: colorObj.id,
            name: newName
          });

          if (response.success) {
            if (response.exists) {
              await showAlertModal(browserAPI.i18n.getMessage('nameAlreadyExists') || 'Name already exists.');
              name.textContent = colorObj.customName || `${browserAPI.i18n.getMessage('customColor') || 'Custom Color'} ${colorObj.colorNumber}`;
            } else {
              const customColors = response.colors.filter(c => c.id.startsWith('custom_'));
              renderCustomColorsList(customColors);
              await loadShortcuts(); // Refresh names in dropdown
              return; // re-rendering handles putting the span back
            }
          }
        }

        info.replaceChild(name, input);
      };

      input.addEventListener('blur', finishEditing);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          input.blur();
        } else if (e.key === 'Escape') {
          isEditingName = false;
          info.replaceChild(name, input);
        }
      });

      info.replaceChild(input, name);
      input.focus();
      input.select();
    });

    const hex = document.createElement('span');
    hex.className = 'color-hex';
    hex.textContent = colorObj.color.toUpperCase();

    info.appendChild(swatch);
    // When editing, info will contain input instead of name. This append handles the initial render.
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
    customColorCount = customColors.length;
    shownCustomColors = customColors;
    syncHideDefaultsFallback();
    syncCustomColorControls();

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

  function syncCustomColorControls() {
    const reordering = reorderDraft !== null;
    // With one colour its own row's Remove is enough, and there is no order to
    // change; both buttons are for the case the rows make tedious.
    const several = shownCustomColors.length >= 2;
    reorderColorsBtn.hidden = reordering || !several;
    clearCustomColorsBtn.hidden = reordering || !several;
    reorderModeLabel.hidden = !reordering;
    reorderActions.hidden = !reordering;
    reorderSaveBtn.disabled = !reordering || !reorderDraftChanged();
    reorderHint.hidden = !reordering;
    addCustomColorBtn.hidden = reordering;
  }

  // --- Reordering ---
  // The new order stays a draft until Save: one write, and so one sync, however
  // many moves it took, and Cancel leaves storage untouched. The rows offer
  // nothing but moving while it lasts, so nothing else can change the list
  // under the draft.

  function customColorDisplayName(colorObj) {
    return colorObj.customName || `${browserAPI.i18n.getMessage('customColor') || 'Custom Color'} ${colorObj.colorNumber}`;
  }

  function reorderDraftChanged() {
    return reorderDraft !== null && reorderDraft.some((c, i) => c.id !== shownCustomColors[i].id);
  }

  function renderReorderList(focus) {
    customColorsList.innerHTML = '';
    reorderDraft.forEach((colorObj, index) => {
      customColorsList.appendChild(buildReorderRow(colorObj, index));
    });
    syncCustomColorControls();
    if (focus) focusMoveButton(focus.colorId, focus.offset);
  }

  function buildReorderRow(colorObj, index) {
    const row = document.createElement('div');
    row.className = 'color-row reorder-row';
    row.dataset.colorId = colorObj.id;

    const info = document.createElement('div');
    info.className = 'color-info';

    // Pointer only: the arrows are the keyboard's way to move a colour.
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.setAttribute('aria-hidden', 'true');
    handle.addEventListener('pointerdown', event => startRowDrag(event, row));

    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.backgroundColor = colorObj.color;

    const name = document.createElement('span');
    name.className = 'color-name';
    name.textContent = customColorDisplayName(colorObj);

    info.appendChild(handle);
    info.appendChild(swatch);
    info.appendChild(name);

    const actions = document.createElement('div');
    actions.className = 'color-actions';
    actions.appendChild(buildMoveButton(colorObj, index, -1));
    actions.appendChild(buildMoveButton(colorObj, index, 1));

    row.appendChild(info);
    row.appendChild(actions);
    return row;
  }

  function buildMoveButton(colorObj, index, offset) {
    const up = offset < 0;
    const colorName = customColorDisplayName(colorObj);
    const label = browserAPI.i18n.getMessage(up ? 'moveColorUp' : 'moveColorDown', [colorName])
      || `Move ${colorName} ${up ? 'up' : 'down'}`;

    const btn = document.createElement('button');
    btn.className = 'btn-move';
    btn.textContent = up ? '▲' : '▼';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.dataset.colorId = colorObj.id;
    btn.dataset.offset = String(offset);
    btn.disabled = up ? index === 0 : index === reorderDraft.length - 1;
    btn.addEventListener('click', () => moveDraftColor(index, offset));
    return btn;
  }

  function moveDraftColor(index, offset) {
    const target = index + offset;
    if (target < 0 || target >= reorderDraft.length) return;
    const [moved] = reorderDraft.splice(index, 1);
    reorderDraft.splice(target, 0, moved);
    renderReorderList({ colorId: moved.id, offset });
  }

  // Keep a keyboard user on the colour they are moving. At the end of the list
  // the button they pressed is disabled, so the other one takes focus.
  function focusMoveButton(colorId, offset) {
    const buttons = [...customColorsList.querySelectorAll('.btn-move')]
      .filter(btn => btn.dataset.colorId === colorId);
    const target = buttons.find(btn => btn.dataset.offset === String(offset) && !btn.disabled)
      || buttons.find(btn => !btn.disabled);
    if (target) target.focus();
  }

  // Pointer events rather than HTML5 drag and drop, which never starts from a
  // touch - and Firefox for Android has this page too.
  //
  // Nothing moves in the DOM until the drop. The held row follows the pointer
  // by transform, and the rows it passes slide out of its way by its height,
  // so it reads as carrying the row rather than as rows jumping about. On
  // release the row glides into the gap and only then does the draft change.
  //
  // The pointer is captured to the handle, so a release outside the window
  // still ends the drag; the rows move only by transform, which keeps the
  // capture. The drag is heard on the document all the same - captured events
  // bubble there, and it does not depend on capture being available. Losing
  // the capture any other way ends the drag where it is.
  const DROP_SETTLE_MS = 150;
  let rowDragActive = false;

  function startRowDrag(event, row) {
    if (event.button !== 0 || rowDragActive) return;
    event.preventDefault();
    rowDragActive = true;
    const handle = event.currentTarget;
    if (handle.setPointerCapture && event.pointerId !== undefined) {
      handle.setPointerCapture(event.pointerId);
    }

    const rows = [...customColorsList.querySelectorAll('.reorder-row')];
    const from = rows.indexOf(row);
    const boxes = rows.map(r => r.getBoundingClientRect());
    const held = boxes[from];
    const centers = boxes.map(box => box.top + box.height / 2);
    // The held row stays within the list: no higher than the first row's top,
    // no lower than the last row's bottom.
    const minDy = boxes[0].top - held.top;
    const maxDy = boxes[boxes.length - 1].bottom - held.bottom;
    const startY = event.clientY;
    let target = from;

    document.documentElement.classList.add('color-row-dragging');
    row.classList.add('dragging');
    rows.forEach((r) => { if (r !== row) r.classList.add('make-way'); });

    const onMove = (moveEvent) => {
      const dy = Math.min(maxDy, Math.max(minDy, moveEvent.clientY - startY));
      row.style.transform = `translateY(${dy}px)`;

      // A row makes way once the held row's leading edge passes its middle.
      // Edges rather than the held row's own middle: rows differ in height (a
      // long name wraps, the last has no border), and a middle measured against
      // a taller or shorter row can stop one slot short of the end.
      const heldTop = held.top + dy;
      const heldBottom = held.bottom + dy;
      target = from;
      for (let i = 0; i < from; i++) {
        if (heldTop <= centers[i]) { target = i; break; }
      }
      for (let i = rows.length - 1; i > from; i--) {
        if (heldBottom >= centers[i]) { target = i; break; }
      }

      rows.forEach((r, i) => {
        if (i === from) return;
        let shift = 0;
        if (from < target && i > from && i <= target) shift = -held.height;
        if (target < from && i >= target && i < from) shift = held.height;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };

    const commit = () => {
      document.documentElement.classList.remove('color-row-dragging');
      rowDragActive = false;
      if (target !== from) {
        const [moved] = reorderDraft.splice(from, 1);
        reorderDraft.splice(target, 0, moved);
      }
      renderReorderList();
    };

    const onEnd = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      handle.removeEventListener('lostpointercapture', onEnd);

      // Where the row will sit once the list is re-rendered in the new order.
      let finalDy = 0;
      if (target > from) finalDy = boxes[target].bottom - held.bottom;
      if (target < from) finalDy = boxes[target].top - held.top;
      row.classList.add('settling');
      row.style.transform = `translateY(${finalDy}px)`;
      setTimeout(commit, DROP_SETTLE_MS);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
    handle.addEventListener('lostpointercapture', onEnd);
  }

  // Saving puts the normal list back without anything else to show it
  // happened, so the page says so for a moment.
  const SAVED_STATUS_MS = 3000;
  let savedStatusTimer = null;

  function showSavedStatus(text) {
    clearTimeout(savedStatusTimer);
    reorderSavedStatus.textContent = text;
    savedStatusTimer = text
      ? setTimeout(() => { reorderSavedStatus.textContent = ''; }, SAVED_STATUS_MS)
      : null;
  }

  reorderColorsBtn.addEventListener('click', () => {
    showSavedStatus('');
    reorderDraft = [...shownCustomColors];
    renderReorderList();
  });

  reorderCancelBtn.addEventListener('click', () => {
    reorderDraft = null;
    renderCustomColorsList(shownCustomColors);
  });

  reorderSaveBtn.addEventListener('click', async () => {
    if (!reorderDraftChanged()) return;
    reorderSaveBtn.disabled = true;

    const response = await sendToBackground({
      action: 'reorderCustomColors',
      ids: reorderDraft.map(c => c.id),
    });
    // Nothing was saved, so the draft stays for another try.
    if (!response || !response.success) {
      syncCustomColorControls();
      return;
    }

    reorderDraft = null;
    renderCustomColorsList((response.colors || []).filter(c => c.id.startsWith('custom_')));
    await loadShortcuts(); // The dropdowns list the colours in palette order
    // The colours changed somewhere else while this page was reordering them;
    // what came back is the current list, to reorder again from.
    if (response.mismatch) {
      await showAlertModal(
        browserAPI.i18n.getMessage('colorOrderOutdated')
          || 'The colors changed elsewhere, so the new order was not saved. Please try again.'
      );
      return;
    }
    showSavedStatus(browserAPI.i18n.getMessage('colorOrderSaved') || '✓ Color order saved.');
  });

  window.addEventListener('beforeunload', (event) => {
    if (!reorderDraftChanged()) return;
    event.preventDefault();
    event.returnValue = '';
  });

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

  clearCustomColorsBtn.addEventListener('click', async () => {
    const confirmed = await showConfirmModal(
      browserAPI.i18n.getMessage('confirmDeleteCustomColors') || 'Delete ALL custom colors?'
    );
    if (!confirmed) return;

    // The confirm can sit open long enough for the worker to go back to sleep,
    // and a rejection here would end the click in an unhandled rejection.
    const response = await sendToBackground({ action: 'clearCustomColors' });
    if (response && response.success) {
      renderCustomColorsList((response.colors || []).filter(c => c.id.startsWith('custom_')));
      await loadShortcuts(); // Refresh options and drop any that were assigned
    }
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
    // The page reloads on focus; coming back from another window must not
    // throw away an order that is still being put together.
    if (reorderDraft !== null) return;
    const response = await browserAPI.runtime.sendMessage({ action: 'getColors' });
    if (response && response.colors) {
      const customColors = response.colors.filter(c => c.id.startsWith('custom_'));
      renderCustomColorsList(customColors);
    }
  }

  // --- Keyboard Shortcuts ---
  const shortcutsList = document.getElementById('shortcuts-list');

  function isCustomColor(colorObj) {
    return colorObj.id && colorObj.id.startsWith('custom_');
  }

  function getCustomColorBaseName() {
    return browserAPI.i18n.getMessage('customColor') || 'Custom Color';
  }

  function buildColorLabel(colorObj) {
    if (colorObj.customName) {
      return colorObj.customName;
    }
    if (isCustomColor(colorObj)) {
      const baseName = getCustomColorBaseName();
      return colorObj.colorNumber ? `${baseName} ${colorObj.colorNumber}` : baseName;
    }
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

    const NAVIGATION_COMMANDS = [
      ['navigate_next_highlight', 'commandNextHighlight', 'Jump to next highlight'],
      ['navigate_previous_highlight', 'commandPreviousHighlight', 'Jump to previous highlight'],
    ];

    // Label on top, key combination under it. Chrome gives these commands no
    // default key, so an unassigned badge is the normal first sight there.
    function buildShortcutInfo(cmdName, label) {
      const cmd = commands.find(c => c.name === cmdName);
      const shortcutLabel = cmd?.shortcut || browserAPI.i18n.getMessage('notAssigned') || '(Not assigned)';

      const info = document.createElement('div');
      info.className = 'shortcut-info';

      const slotLabel = document.createElement('span');
      slotLabel.className = 'shortcut-slot';
      slotLabel.textContent = label;

      const keyBadge = document.createElement('span');
      keyBadge.className = 'key-badge';
      keyBadge.textContent = shortcutLabel;

      info.appendChild(slotLabel);
      info.appendChild(keyBadge);
      return info;
    }

    SLOT_COMMANDS.forEach((cmdName, idx) => {
      const assignedColorId = colorMap[cmdName] ?? null;

      const row = document.createElement('div');
      row.className = 'shortcut-row';

      const info = buildShortcutInfo(
        cmdName,
        `${browserAPI.i18n.getMessage('shortcutSlot') || 'Slot'} ${idx + 1}`
      );

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

    NAVIGATION_COMMANDS.forEach(([cmdName, messageKey, fallback]) => {
      const row = document.createElement('div');
      row.className = 'shortcut-row shortcut-row-navigation';
      row.appendChild(buildShortcutInfo(cmdName, browserAPI.i18n.getMessage(messageKey) || fallback));
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

  // --- Cloud Sync ---
  const cloudSyncSetup = document.getElementById('cloud-sync-setup');
  const cloudSyncConnected = document.getElementById('cloud-sync-connected');
  const cloudSyncGenerateBtn = document.getElementById('cloud-sync-generate-btn');
  const cloudSyncPairInput = document.getElementById('cloud-sync-pair-input');
  const cloudSyncPairBtn = document.getElementById('cloud-sync-pair-btn');
  const cloudSyncToggle = document.getElementById('cloud-sync-toggle');
  const cloudSyncCodeDisplay = document.getElementById('cloud-sync-code-display');
  const cloudSyncToggleVisibilityBtn = document.getElementById('cloud-sync-toggle-visibility-btn');
  const cloudSyncCopyBtn = document.getElementById('cloud-sync-copy-btn');
  const cloudSyncStatusText = document.getElementById('cloud-sync-status-text');
  const cloudSyncNowBtn = document.getElementById('cloud-sync-now-btn');
  const cloudSyncResetBtn = document.getElementById('cloud-sync-reset-btn');

  let currentSyncCode = null;
  let isSyncCodeVisible = false;

  function maskSyncCode(code) {
    const groups = code.split('-');
    if (groups.length <= 2) return code;
    return groups
      .map((group, index) => (index === 0 || index === groups.length - 1 ? group : '•'.repeat(group.length)))
      .join('-');
  }

  function renderSyncCodeDisplay() {
    if (!currentSyncCode) return;
    cloudSyncCodeDisplay.textContent = isSyncCodeVisible ? currentSyncCode : maskSyncCode(currentSyncCode);
    cloudSyncToggleVisibilityBtn.textContent = browserAPI.i18n.getMessage(
      isSyncCodeVisible ? 'cloudSyncHideCode' : 'cloudSyncShowCode'
    ) || (isSyncCodeVisible ? 'Hide' : 'Show');
  }

  function formatCloudSyncError(status) {
    return `${browserAPI.i18n.getMessage('cloudSyncErrorPrefix') || 'Sync error: '}${status.lastError}`;
  }

  function formatTrimmedNotice(trimmedCount) {
    if (!trimmedCount) return '';
    const message = browserAPI.i18n.getMessage('cloudSyncPagesExcludedNotice', [String(trimmedCount)]) ||
      `(${trimmedCount} older page(s) excluded due to the size limit)`;
    return ` ${message}`;
  }

  function renderCloudSyncStatus(status) {
    cloudSyncToggle.checked = !!status.enabled;

    if (status.lastError) {
      cloudSyncStatusText.textContent = formatCloudSyncError(status);
      cloudSyncStatusText.classList.add('cloud-sync-error-text');
    } else if (status.lastSyncedAt) {
      cloudSyncStatusText.textContent =
        `${browserAPI.i18n.getMessage('cloudSyncLastSyncedPrefix') || 'Last synced: '}${new Date(status.lastSyncedAt).toLocaleString()}${formatTrimmedNotice(status.lastTrimmedCount)}`;
      cloudSyncStatusText.classList.remove('cloud-sync-error-text');
    } else {
      cloudSyncStatusText.textContent = browserAPI.i18n.getMessage('cloudSyncNeverSynced') || 'Not synced yet';
      cloudSyncStatusText.classList.remove('cloud-sync-error-text');
    }
  }

  function renderCloudSyncView(status) {
    if (currentSyncCode !== status.code) {
      isSyncCodeVisible = false;
    }
    currentSyncCode = status.code;

    if (status.code) {
      cloudSyncSetup.style.display = 'none';
      cloudSyncConnected.style.display = '';
      renderSyncCodeDisplay();
      renderCloudSyncStatus(status);
    } else {
      cloudSyncSetup.style.display = '';
      cloudSyncConnected.style.display = 'none';
    }
  }

  async function loadCloudSyncStatus() {
    const response = await browserAPI.runtime.sendMessage({ action: 'getCloudSyncStatus' });
    if (response && response.success) {
      renderCloudSyncView(response);
    }
  }

  cloudSyncGenerateBtn.addEventListener('click', async () => {
    cloudSyncGenerateBtn.disabled = true;
    try {
      const response = await browserAPI.runtime.sendMessage({ action: 'enableCloudSync' });
      if (response && response.success) {
        await loadCloudSyncStatus();
      }
    } finally {
      cloudSyncGenerateBtn.disabled = false;
    }
  });

  cloudSyncPairBtn.addEventListener('click', async () => {
    const code = cloudSyncPairInput.value.trim();
    if (!code) return;

    cloudSyncPairBtn.disabled = true;
    try {
      const response = await browserAPI.runtime.sendMessage({ action: 'pairCloudSync', code });
      if (response && response.success) {
        cloudSyncPairInput.value = '';
        await loadCloudSyncStatus();
      } else {
        await showAlertModal(browserAPI.i18n.getMessage('cloudSyncInvalidCode') || "That sync code doesn't look right.");
      }
    } finally {
      cloudSyncPairBtn.disabled = false;
    }
  });

  cloudSyncToggle.addEventListener('change', async () => {
    if (cloudSyncToggle.checked) {
      if (currentSyncCode) {
        await browserAPI.runtime.sendMessage({ action: 'pairCloudSync', code: currentSyncCode });
      }
    } else {
      await browserAPI.runtime.sendMessage({ action: 'disableCloudSync' });
    }
    await loadCloudSyncStatus();
  });

  cloudSyncToggleVisibilityBtn.addEventListener('click', () => {
    isSyncCodeVisible = !isSyncCodeVisible;
    renderSyncCodeDisplay();
  });

  cloudSyncCopyBtn.addEventListener('click', async () => {
    if (!currentSyncCode) return;
    const copied = await copyTextToClipboard(currentSyncCode);
    if (copied) {
      const original = cloudSyncCopyBtn.textContent;
      cloudSyncCopyBtn.textContent = browserAPI.i18n.getMessage('cloudSyncCodeCopied') || 'Copied!';
      setTimeout(() => { cloudSyncCopyBtn.textContent = original; }, 1500);
    } else {
      isSyncCodeVisible = true;
      renderSyncCodeDisplay();
      await showAlertModal(
        browserAPI.i18n.getMessage('cloudSyncCopyFailed') ||
          "Couldn't copy automatically. The code is now shown above - please copy it manually."
      );
    }
  });

  cloudSyncNowBtn.addEventListener('click', async () => {
    cloudSyncNowBtn.disabled = true;
    const originalText = cloudSyncNowBtn.textContent;
    cloudSyncNowBtn.textContent = browserAPI.i18n.getMessage('cloudSyncSyncing') || 'Syncing...';
    try {
      await browserAPI.runtime.sendMessage({ action: 'triggerCloudSync' });
      await loadCloudSyncStatus();
    } finally {
      cloudSyncNowBtn.disabled = false;
      cloudSyncNowBtn.textContent = originalText;
    }
  });

  cloudSyncResetBtn.addEventListener('click', async () => {
    const confirmed = await showConfirmModal(
      browserAPI.i18n.getMessage('cloudSyncResetConfirm') ||
      'This disconnects this device and permanently forgets the sync code. Continue?'
    );
    if (!confirmed) return;

    await browserAPI.runtime.sendMessage({ action: 'resetCloudSyncCode' });
    await loadCloudSyncStatus();
  });

  // --- Init ---
  if (!browserAPI.commands) {
    document.getElementById('shortcuts-section').style.display = 'none';
  }

  await Promise.all([
    loadGeneralSettings(),
    loadCustomColors(),
    loadShortcuts(),
    loadCloudSyncStatus()
  ]);

  window.addEventListener('focus', async () => {
    await Promise.all([
      loadCustomColors(),
      loadShortcuts(),
      loadCloudSyncStatus()
    ]);
  });
});
