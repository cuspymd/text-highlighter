import { browserAPI } from './shared/browser-api.js';
import { debugLog } from './shared/logger.js';

const URL_PARAMS  = new URLSearchParams(window.location.search);

async function getActiveTab() {
  // Open popup.html?tab=5 to use tab ID 5, etc.
  if (URL_PARAMS.has("tab")) {
    const tabId = parseInt(URL_PARAMS.get("tab"));
    return await browserAPI.tabs.get(tabId);
  }

  const tabs = await browserAPI.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0];
}

// Internationalization helper
function initializeI18n() {
  // Get all elements with data-i18n attribute
  const elements = document.querySelectorAll('[data-i18n]');

  elements.forEach(element => {
    const key = element.getAttribute('data-i18n');
    const message = browserAPI.i18n.getMessage(key);

    if (message) {
      // Set the content based on element type
      if (element.tagName === 'INPUT' && element.type === 'button') {
        element.value = message;
      } else if (element.tagName === 'INPUT' && element.placeholder !== undefined) {
        element.placeholder = message;
      } else if (element.tagName === 'META' && element.name === 'description') {
        element.content = message;
      } else if (element.tagName === 'TITLE') {
        element.textContent = message;
      } else {
        element.textContent = message;
      }
    }
  });
  
  // Handle data-i18n-title attributes
  const elementsWithTitle = document.querySelectorAll('[data-i18n-title]');
  elementsWithTitle.forEach(element => {
    const key = element.getAttribute('data-i18n-title');
    const message = browserAPI.i18n.getMessage(key);
    if (message) {
      element.title = message;
    }
  });
}

// Theme change detection and handling
function initializeThemeWatcher() {
  const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  
  // Initial theme application
  updateTheme(darkModeQuery.matches);
  
  // Detect theme change
  darkModeQuery.addEventListener('change', (e) => {
    updateTheme(e.matches);
  });
}

function updateTheme(isDark) {
  document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

// Custom modal functions to replace alert/confirm for Firefox compatibility
function showConfirmModal(message) {
  return new Promise((resolve) => {
    const modal = createModal();
    const content = modal.querySelector('.modal-content');
    
    // Clear content
    content.replaceChildren();
    
    // Create paragraph
    const p = document.createElement('p');
    p.textContent = message;
    content.appendChild(p);
    
    // Create button container
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'modal-buttons';
    
    // Create confirm button
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'modal-btn modal-confirm';
    confirmBtn.textContent = browserAPI.i18n.getMessage('ok') || 'OK';
    
    // Create cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'modal-btn modal-cancel';
    cancelBtn.textContent = browserAPI.i18n.getMessage('cancel') || 'Cancel';
    
    buttonsDiv.appendChild(confirmBtn);
    buttonsDiv.appendChild(cancelBtn);
    content.appendChild(buttonsDiv);
    
    confirmBtn.addEventListener('click', () => {
      removeModal(modal);
      resolve(true);
    });
    
    cancelBtn.addEventListener('click', () => {
      removeModal(modal);
      resolve(false);
    });
    
    // ESC key to cancel
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', escHandler);
        removeModal(modal);
        resolve(false);
      }
    });
  });
}

function showAlertModal(message) {
  return new Promise((resolve) => {
    const modal = createModal();
    const content = modal.querySelector('.modal-content');
    
    // Clear content
    content.replaceChildren();
    
    // Create paragraph
    const p = document.createElement('p');
    p.textContent = message;
    content.appendChild(p);
    
    // Create button container
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'modal-buttons';
    
    // Create confirm button
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'modal-btn modal-confirm';
    confirmBtn.textContent = browserAPI.i18n.getMessage('ok') || 'OK';
    
    buttonsDiv.appendChild(confirmBtn);
    content.appendChild(buttonsDiv);
    
    confirmBtn.addEventListener('click', () => {
      removeModal(modal);
      resolve();
    });
    
    // ESC key to close
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', escHandler);
        removeModal(modal);
        resolve();
      }
    });
  });
}

function createModal() {
  const modal = document.createElement('div');
  modal.className = 'custom-modal';
  
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  
  const content = document.createElement('div');
  content.className = 'modal-content';
  
  modal.appendChild(overlay);
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Close on overlay click
  overlay.addEventListener('click', () => {
    removeModal(modal);
  });
  
  return modal;
}

function removeModal(modal) {
  if (modal && modal.parentNode) {
    modal.parentNode.removeChild(modal);
  }
}

document.addEventListener('DOMContentLoaded', async function () {
  // Initialize internationalization first
  initializeI18n();
  
  // Initialize theme watcher
  initializeThemeWatcher();

  const highlightsContainer = document.getElementById('highlights-container');
  const noHighlights = document.getElementById('no-highlights');
  const clearAllBtn = document.getElementById('clear-all');
  const viewAllPagesBtn = document.getElementById('view-all-pages');
  const deleteCustomColorsBtn = document.getElementById('delete-custom-colors');
  const minimapToggle = document.getElementById('minimap-toggle');
  const selectionControlsToggle = document.getElementById('selection-controls-toggle');
  // Load highlight information from current active tab
  async function loadHighlights() {
    const tab = await getActiveTab();
    const currentUrl = tab.url;
    if (!currentUrl) return;

    const result = await browserAPI.storage.local.get([currentUrl]);
    let highlights = result[currentUrl] || [];

    // Since it's a group structure, use the position of the representative span
    highlights.sort((a, b) => {
      const posA = a.spans && a.spans[0] ? a.spans[0].position : 0;
      const posB = b.spans && b.spans[0] ? b.spans[0].position : 0;
      return posA - posB;
    });

    debugLog('Loaded highlights for popup (sorted by position):', highlights);

    // Display highlight list (group basis)
    if (highlights.length > 0) {
      noHighlights.style.display = 'none';
      highlightsContainer.innerHTML = '';

      highlights.forEach(group => {
        const highlightItem = document.createElement('div');
        highlightItem.className = 'highlight-item';
        highlightItem.style.backgroundColor = group.color;
        highlightItem.dataset.groupId = group.groupId;

        // Truncate text if too long
        let displayText = group.text;
        if (displayText.length > 48) {
          displayText = displayText.substring(0, 45) + '...';
        }
        highlightItem.textContent = displayText;

        // Add delete button
        const deleteBtn = document.createElement('span');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = '×';
        deleteBtn.title = browserAPI.i18n.getMessage('removeHighlight');
        deleteBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          deleteHighlight(group.groupId, currentUrl);
        });

        highlightItem.appendChild(deleteBtn);
        highlightsContainer.appendChild(highlightItem);
      });
    } else {
      noHighlights.style.display = 'block';
      highlightsContainer.innerHTML = '';
      highlightsContainer.appendChild(noHighlights);
    }
  }

  // Load minimap settings
  async function loadMinimapSetting() {
    const result = await browserAPI.storage.local.get(['minimapVisible']);
    // Default value is true (show minimap)
    const isVisible = result.minimapVisible !== undefined ? result.minimapVisible : true;
    minimapToggle.checked = isVisible;
    debugLog('Loaded minimap setting:', isVisible);
  }

  // Load selection controls setting
  async function loadSelectionControlsSetting() {
    // On mobile (no browserAPI.windows), always enable and hide the toggle
    if (!browserAPI.windows) {
      selectionControlsToggle.closest('.toggle-container').style.display = 'none';
      debugLog('Mobile platform: selection controls always enabled, toggle hidden');
      return;
    }
    const result = await browserAPI.storage.local.get(['selectionControlsVisible']);
    // Default value is true (show controls on selection)
    const isVisible = result.selectionControlsVisible !== undefined ? result.selectionControlsVisible : true;
    selectionControlsToggle.checked = isVisible;
    debugLog('Loaded selection controls setting:', isVisible);
  }

  // Save minimap settings (background handles immediate local broadcast + sync)
  minimapToggle.addEventListener('change', async function () {
    const isVisible = minimapToggle.checked;

    // Save to storage via background
    await browserAPI.runtime.sendMessage({
      action: 'saveSettings',
      minimapVisible: isVisible
    });
    debugLog('Minimap visibility saved:', isVisible);
  });

  // Save selection controls settings (background handles immediate local broadcast + sync)
  selectionControlsToggle.addEventListener('change', async function () {
    const isVisible = selectionControlsToggle.checked;

    // Save to storage via background
    await browserAPI.runtime.sendMessage({
      action: 'saveSettings',
      selectionControlsVisible: isVisible
    });
    debugLog('Selection controls visibility saved:', isVisible);
  });

  // Delete highlight (group basis)
  async function deleteHighlight(groupId, url) {
    const response = await browserAPI.runtime.sendMessage({
      action: 'deleteHighlight',
      url: url,
      groupId: groupId, // Delete by groupId
      notifyRefresh: true
    });
    if (response && response.success) {
      debugLog('Highlight group deleted through background:', groupId);
      await loadHighlights();
    }
  }

  // Delete all highlights
  clearAllBtn.addEventListener('click', async function () {
    debugLog('Clearing all highlights');
    const confirmMessage = browserAPI.i18n.getMessage('confirmClearAll');
    const confirmed = await showConfirmModal(confirmMessage);
    if (confirmed) {
      const tab = await getActiveTab();
      const currentUrl = tab.url;
      if (!currentUrl) return;
      
      const response = await browserAPI.runtime.sendMessage({
        action: 'clearAllHighlights',
        url: currentUrl,
        notifyRefresh: true
      });
      
      if (response && response.success) {
        debugLog('All highlights cleared through background');
        await loadHighlights();
      }
    }
  });

  // Delete all custom colors
  deleteCustomColorsBtn.addEventListener('click', async function () {
    debugLog('Deleting all custom colors');
    const confirmMessage = browserAPI.i18n.getMessage('confirmDeleteCustomColors') || 'Delete all custom colors?';
    const confirmed = await showConfirmModal(confirmMessage);
    if (confirmed) {
      const response = await browserAPI.runtime.sendMessage({ action: 'clearCustomColors' });
      if (response && response.success) {
        if (response.noCustomColors) {
          debugLog('No custom colors to delete');
          await showAlertModal(browserAPI.i18n.getMessage('noCustomColorsToDelete') || 'No custom colors to delete.');
        } else {
          debugLog('All custom colors deleted');
          await showAlertModal(browserAPI.i18n.getMessage('deletedCustomColors') || 'Custom colors deleted.');
        }
      }
    }
  });

  // View list of highlighted pages
  viewAllPagesBtn.addEventListener('click', function () {
    debugLog('Opening all pages list');
    const targetUrl = browserAPI.runtime.getURL('pages-list.html');

    // browserAPI.windows is not available on Firefox Android
    if (browserAPI.windows) {
      browserAPI.windows.getAll({populate: true}, function(windows) {
        let found = false;
        for (const win of windows) {
          for (const tab of win.tabs) {
            if (tab.url && tab.url.startsWith(targetUrl)) {
              browserAPI.windows.update(win.id, {focused: true});
              browserAPI.tabs.update(tab.id, {active: true});
              browserAPI.tabs.sendMessage(tab.id, {action: 'refreshPagesList'});
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (!found) {
          browserAPI.windows.create({
            url: targetUrl,
            type: 'popup',
            width: 860,
            height: 600
          });
        }
      });
    } else {
      // Mobile fallback: use tabs API only
      browserAPI.tabs.query({}, function(tabs) {
        const existingTab = tabs.find(tab => tab.url && tab.url.startsWith(targetUrl));
        if (existingTab) {
          browserAPI.tabs.update(existingTab.id, {active: true});
          browserAPI.tabs.sendMessage(existingTab.id, {action: 'refreshPagesList'});
        } else {
          browserAPI.tabs.create({ url: targetUrl });
        }
        // Close the popup so the user sees the page directly
        window.close();
      });
    }
  });

  // Initialization
  await loadHighlights();
  await loadMinimapSetting();
  await loadSelectionControlsSetting();
});
