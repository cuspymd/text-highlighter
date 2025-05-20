// Internationalization helper
function initializeI18n() {
  // Get all elements with data-i18n attribute
  const elements = document.querySelectorAll('[data-i18n]');

  elements.forEach(element => {
    const key = element.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(key);

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
}

document.addEventListener('DOMContentLoaded', function () {
  // Initialize internationalization first
  initializeI18n();

  const highlightsContainer = document.getElementById('highlights-container');
  const noHighlights = document.getElementById('no-highlights');
  const clearAllBtn = document.getElementById('clear-all');
  const exportDataBtn = document.getElementById('export-data');
  const viewAllPagesBtn = document.getElementById('view-all-pages');
  const minimapToggle = document.getElementById('minimap-toggle');

  // Set debug mode - change to true during development
  const DEBUG_MODE = false;

  // Debug log function
  function debugLog(...args) {
    if (DEBUG_MODE) {
      console.log(...args);
    }
  }

  // Load highlight information from current active tab
  function loadHighlights() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentUrl = tabs[0].url;

      chrome.storage.local.get([currentUrl], (result) => {
        let highlights = result[currentUrl] || [];

        highlights.sort((a, b) => (a.position || 0) - (b.position || 0));

        debugLog('Loaded highlights for popup (sorted by position):', highlights);

        // Display highlight list
        if (highlights.length > 0) {
          noHighlights.style.display = 'none';
          highlightsContainer.innerHTML = '';

          highlights.forEach(highlight => {
            const highlightItem = document.createElement('div');
            highlightItem.className = 'highlight-item';
            highlightItem.style.backgroundColor = highlight.color;
            highlightItem.dataset.id = highlight.id;

            // Truncate text if too long
            let displayText = highlight.text;
            if (displayText.length > 50) {
              displayText = displayText.substring(0, 47) + '...';
            }

            highlightItem.textContent = displayText;

            // Add delete button
            const deleteBtn = document.createElement('span');
            deleteBtn.className = 'delete-btn';
            deleteBtn.textContent = '×';
            deleteBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              deleteHighlight(highlight.id, currentUrl);
            });

            highlightItem.appendChild(deleteBtn);
            highlightsContainer.appendChild(highlightItem);
          });
        } else {
          noHighlights.style.display = 'block';
          highlightsContainer.innerHTML = '';
          highlightsContainer.appendChild(noHighlights);
        }
      });
    });
  }

  // Load minimap settings
  function loadMinimapSetting() {
    chrome.storage.local.get(['minimapVisible'], (result) => {
      // Default value is true (show minimap)
      const isVisible = result.minimapVisible !== undefined ? result.minimapVisible : true;
      minimapToggle.checked = isVisible;
      debugLog('Loaded minimap setting:', isVisible);
    });
  }

  // Save and apply minimap settings to current page
  minimapToggle.addEventListener('change', function () {
    const isVisible = minimapToggle.checked;

    // Save to storage
    chrome.storage.local.set({ minimapVisible: isVisible }, () => {
      debugLog('Minimap visibility saved:', isVisible);

      // Apply settings to current page
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'setMinimapVisibility',
          visible: isVisible
        });
      });
    });
  });

  // Delete highlight
  function deleteHighlight(id, url) {
    chrome.storage.local.get([url], (result) => {
      const highlights = result[url] || [];
      const updatedHighlights = highlights.filter(h => h.id !== id);

      const saveData = {};
      saveData[url] = updatedHighlights;

      chrome.storage.local.set(saveData, () => {
        debugLog('Highlight deleted:', id);
        // Update highlights on current page
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'refreshHighlights',
            highlights: updatedHighlights
          });
        });

        loadHighlights();
      });
    });
  }

  // Delete all highlights
  clearAllBtn.addEventListener('click', function () {
    const confirmMessage = chrome.i18n.getMessage('confirmClearAll');
    if (confirm(confirmMessage)) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentUrl = tabs[0].url;

        const saveData = {};
        saveData[currentUrl] = [];

        chrome.storage.local.set(saveData, () => {
          debugLog('All highlights cleared');
          // Update highlights on current page
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'refreshHighlights',
            highlights: []
          });

          loadHighlights();
        });
      });
    }
  });

  // Export highlight data
  exportDataBtn.addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentUrl = tabs[0].url;

      chrome.storage.local.get([currentUrl], (result) => {
        const highlights = result[currentUrl] || [];

        // Create export data
        const exportData = {
          url: currentUrl,
          title: tabs[0].title,
          date: new Date().toISOString(),
          highlights: highlights
        };

        debugLog('Exporting highlights data:', exportData);

        // Download as file
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
          type: 'application/json'
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'highlights-' + new Date().getTime() + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    });
  });

  // View list of highlighted pages
  viewAllPagesBtn.addEventListener('click', function () {
    debugLog('Opening all pages list');
    chrome.windows.create({
      url: chrome.runtime.getURL('pages-list.html'),
      type: 'popup',
      width: 860,
      height: 600
    });
  });

  // Initialization
  loadHighlights();
  loadMinimapSetting();
});
