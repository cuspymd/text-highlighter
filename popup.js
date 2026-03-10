import { browserAPI } from './shared/browser-api.js';
import { debugLog } from './shared/logger.js';
import { createLocalizedModalHelpers } from './shared/modal.js';
import { initializeThemeWatcher } from './shared/theme.js';

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

const { showConfirmModal, showAlertModal } = createLocalizedModalHelpers(
  (key, defaultValue) => browserAPI.i18n.getMessage(key) || defaultValue
);

document.addEventListener('DOMContentLoaded', async function () {
  // Initialize internationalization first
  initializeI18n();
  
  // Initialize theme watcher
  initializeThemeWatcher();

  const highlightsContainer = document.getElementById('highlights-container');
  const noHighlights = document.getElementById('no-highlights');
  const clearAllBtn = document.getElementById('clear-all');
  const viewAllPagesBtn = document.getElementById('view-all-pages');
  const openSettingsBtn = document.getElementById('open-settings');

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

    // Enable/disable clear-all button based on highlight count
    clearAllBtn.disabled = highlights.length === 0;

    // Display highlight list (group basis)
    if (highlights.length > 0) {
      noHighlights.style.display = 'none';
      highlightsContainer.innerHTML = '';

      highlights.forEach(group => {
        const highlightItem = document.createElement('div');
        highlightItem.className = 'highlight-item';
        highlightItem.dataset.groupId = group.groupId;
        highlightItem.style.setProperty('--highlight-color', group.color);

        // Truncate text if too long
        let displayText = group.text;
        if (displayText.length > 80) {
          displayText = displayText.substring(0, 77) + '...';
        }

        const textSpan = document.createElement('div');
        textSpan.className = 'highlight-text';
        textSpan.textContent = displayText;

        // Add delete button
        const deleteBtn = document.createElement('span');
        deleteBtn.className = 'delete-btn';
        const removeLabel = browserAPI.i18n.getMessage('removeHighlight');
        deleteBtn.title = removeLabel;
        deleteBtn.setAttribute('aria-label', removeLabel);

        const deleteIcon = document.createElement('span');
        deleteIcon.className = 'delete-icon';
        deleteIcon.textContent = 'x';
        deleteBtn.appendChild(deleteIcon);
        deleteBtn.addEventListener('click', async function (e) {
          e.stopPropagation();
          const confirmMessage =
            browserAPI.i18n.getMessage('confirmDeleteHighlight') ||
            browserAPI.i18n.getMessage('confirmDeletePage') ||
            'Delete this highlight?';
          const confirmed = await showConfirmModal(confirmMessage);
          if (confirmed) {
            await deleteHighlight(group.groupId, currentUrl);
          }
        });

        highlightItem.appendChild(textSpan);
        highlightItem.appendChild(deleteBtn);
        highlightsContainer.appendChild(highlightItem);
      });
    } else {
      noHighlights.style.display = 'block';
      highlightsContainer.innerHTML = '';
      highlightsContainer.appendChild(noHighlights);
    }
  }

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

  // View list of highlighted pages
  function openPagesList() {
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
          const w = 860, h = 600;
          const left = Math.round((window.screen.width - w) / 2);
          const top = Math.round((window.screen.height - h) / 2);
          browserAPI.windows.create({
            url: targetUrl,
            type: 'popup',
            width: w,
            height: h,
            left,
            top,
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
  }

  viewAllPagesBtn.addEventListener('click', openPagesList);

  openSettingsBtn.addEventListener('click', () => {
    const settingsUrl = browserAPI.runtime.getURL('settings.html');
    if (browserAPI.windows) {
      const w = 440, h = 620;
      const left = Math.round((window.screen.width - w) / 2);
      const top = Math.round((window.screen.height - h) / 2);
      browserAPI.windows.create({
        url: settingsUrl,
        type: 'popup',
        width: w,
        height: h,
        left,
        top,
      });
    } else {
      // Mobile fallback
      browserAPI.tabs.create({ url: settingsUrl });
      window.close();
    }
  });

  // Initialization
  await loadHighlights();
});
