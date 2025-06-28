const URL_PARAMS  = new URLSearchParams(window.location.search);

async function getActiveTab() {
  // Open popup.html?tab=5 to use tab ID 5, etc.
  if (URL_PARAMS.has("tab")) {
    const tabId = parseInt(URL_PARAMS.get("tab"));
    return await browser.tabs.get(tabId);
  }

  const tabs = await browser.tabs.query({
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
    const message = browser.i18n.getMessage(key);

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
    const message = browser.i18n.getMessage(key);
    if (message) {
      element.title = message;
    }
  });
}

// 테마 변경 감지 및 처리
function initializeThemeWatcher() {
  const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  
  // 초기 테마 적용
  updateTheme(darkModeQuery.matches);
  
  // 테마 변경 감지
  darkModeQuery.addEventListener('change', (e) => {
    updateTheme(e.matches);
  });
}

function updateTheme(isDark) {
  document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
  
  // Chrome 확장에서 현재 브라우저 테마 정보도 가져올 수 있음
  if (browser.theme && browser.theme.getCurrent) {
    browser.theme.getCurrent((theme) => {
      // 브라우저 커스텀 테마가 있으면 추가로 처리 가능
      console.log('Current browser theme:', theme);
    });
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
  // Set debug mode - change to true during development
  const DEBUG_MODE = false;

  // Debug log function
  const debugLog = DEBUG_MODE ? console.log.bind(console) : () => {};

  // Load highlight information from current active tab
  async function loadHighlights() {
    const tab = await getActiveTab();
    const currentUrl = tab.url;
    if (!currentUrl) return;

    const result = await browser.storage.local.get([currentUrl]);
    let highlights = result[currentUrl] || [];

    // 그룹 구조이므로 position은 대표 span의 position 사용
    highlights.sort((a, b) => {
      const posA = a.spans && a.spans[0] ? a.spans[0].position : 0;
      const posB = b.spans && b.spans[0] ? b.spans[0].position : 0;
      return posA - posB;
    });

    debugLog('Loaded highlights for popup (sorted by position):', highlights);

    // Display highlight list (그룹 단위)
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
        deleteBtn.title = browser.i18n.getMessage('removeHighlight');
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
    const result = await browser.storage.local.get(['minimapVisible']);
    // Default value is true (show minimap)
    const isVisible = result.minimapVisible !== undefined ? result.minimapVisible : true;
    minimapToggle.checked = isVisible;
    debugLog('Loaded minimap setting:', isVisible);
  }

  // Save and apply minimap settings to current page
  minimapToggle.addEventListener('change', async function () {
    const isVisible = minimapToggle.checked;

    // Save to storage
    await browser.storage.local.set({ minimapVisible: isVisible });
    debugLog('Minimap visibility saved:', isVisible);

    // Apply settings to current page
    const tab = await getActiveTab();
    await browser.tabs.sendMessage(tab.id, {
      action: 'setMinimapVisibility',
      visible: isVisible
    });
  });

  // Delete highlight (그룹 단위)
  async function deleteHighlight(groupId, url) {
    const response = await browser.runtime.sendMessage({
      action: 'deleteHighlight',
      url: url,
      groupId: groupId, // groupId로 삭제
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
    const confirmMessage = browser.i18n.getMessage('confirmClearAll');
    if (confirm(confirmMessage)) {
      const tab = await getActiveTab();
      const currentUrl = tab.url;
      if (!currentUrl) return;
      
      const response = await browser.runtime.sendMessage({
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
    const confirmMessage = browser.i18n.getMessage('confirmDeleteCustomColors') || 'Delete all custom colors?';
    if (confirm(confirmMessage)) {
      const response = await browser.runtime.sendMessage({ action: 'clearCustomColors' });
      if (response && response.success) {
        if (response.noCustomColors) {
          debugLog('No custom colors to delete');
          alert(browser.i18n.getMessage('noCustomColorsToDelete') || 'No custom colors to delete.');
        } else {
          debugLog('All custom colors deleted');
          alert(browser.i18n.getMessage('deletedCustomColors') || 'Custom colors deleted.');
        }
      }
    }
  });

  // View list of highlighted pages
  viewAllPagesBtn.addEventListener('click', function () {
    debugLog('Opening all pages list');
    const targetUrl = browser.runtime.getURL('pages-list.html');
    browser.windows.getAll({populate: true}, function(windows) {
      let found = false;
      for (const win of windows) {
        for (const tab of win.tabs) {
          if (tab.url && tab.url.startsWith(targetUrl)) {
            browser.windows.update(win.id, {focused: true});
            browser.tabs.update(tab.id, {active: true});
            // 페이지 목록 갱신 메시지 전송
            browser.tabs.sendMessage(tab.id, {action: 'refreshPagesList'});
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) {
        browser.windows.create({
          url: targetUrl,
          type: 'popup',
          width: 860,
          height: 600
        });
      }
    });
  });

  // Initialization
  await loadHighlights();
  await loadMinimapSetting();
});