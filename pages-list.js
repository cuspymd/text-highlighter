// Cross-browser compatibility - use chrome API in Chrome, browser API in Firefox
const browserAPI = (() => {
  if (typeof browser !== 'undefined') {
    return browser;
  }
  if (typeof chrome !== 'undefined') {
    return chrome;
  }
  throw new Error('Neither browser nor chrome API is available');
})();

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
}

document.addEventListener('DOMContentLoaded', function () {
  // Initialize theme watcher
  initializeThemeWatcher();

  // 페이지 로드 완료 후 transition 활성화
  setTimeout(() => {
    document.body.classList.remove('preload');
  }, 50);

  const pagesContainer = document.getElementById('pages-container');
  const noPages = document.getElementById('no-pages');

  // Set debug mode - change to true during development
  const DEBUG_MODE = false;

  // Debug log function
  const debugLog = DEBUG_MODE ? console.log.bind(console) : () => { };

  // Function to get messages for multi-language support
  function getMessage(key, defaultValue = '', substitutions) {
    if (typeof chrome !== 'undefined' && browserAPI.i18n) {
      if (substitutions) {
        return browserAPI.i18n.getMessage(key, substitutions) || defaultValue;
      }
      return browserAPI.i18n.getMessage(key) || defaultValue;
    }
    return defaultValue;
  }

  function isSafeOpenUrl(urlString) {
    if (!urlString) return false;
    try {
      const url = new URL(urlString);
      return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:';
    } catch (e) {
      return false;
    }
  }

  // Change text of HTML elements to multi-language
  function localizeStaticElements() {
    const elementsToLocalize = document.querySelectorAll('[data-i18n]');
    elementsToLocalize.forEach(element => {
      const key = element.getAttribute('data-i18n');
      element.textContent = getMessage(key, element.textContent);
    });

    // Handle data-i18n-title attributes
    const elementsWithTitle = document.querySelectorAll('[data-i18n-title]');
    elementsWithTitle.forEach(element => {
      const key = element.getAttribute('data-i18n-title');
      element.title = getMessage(key, element.title);
    });

    // Handle data-i18n-placeholder attributes
    const elementsWithPlaceholder = document.querySelectorAll('[data-i18n-placeholder]');
    elementsWithPlaceholder.forEach(element => {
      const key = element.getAttribute('data-i18n-placeholder');
      element.placeholder = getMessage(key, element.placeholder);
    });
  }

  // Load all highlighted pages data
  function loadAllHighlightedPages() {
    browserAPI.runtime.sendMessage({ action: 'getAllHighlightedPages' }, (response) => {
      if (response && response.success) {
        debugLog('Received all highlighted pages from background:', response.pages);
        displayPages(response.pages);
      } else {
        debugLog('Error loading highlighted pages:', response);
        displayPages([]);
      }
    });
  }

  // Search functionality
  function filterPages(searchTerm) {
    if (!searchTerm.trim()) {
      filteredPages = [...allPages];
    } else {
      const term = searchTerm.toLowerCase();
      filteredPages = allPages.filter(page => {
        // Search in page title
        const titleMatch = (page.title || '').toLowerCase().includes(term);

        // Search in highlight text
        const highlightMatch = page.highlights && page.highlights.some(group =>
          group.text && group.text.toLowerCase().includes(term)
        );

        return titleMatch || highlightMatch;
      });
    }

    sortAndDisplayPages();
  }

  // Sort functionality
  function sortPages() {
    if (currentSortMode === 'timeDesc') {
      filteredPages.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
    } else {
      filteredPages.sort((a, b) => new Date(a.lastUpdated) - new Date(b.lastUpdated));
    }
  }

  // Sort and display pages
  function sortAndDisplayPages() {
    sortPages();
    displayFilteredPages(filteredPages);
  }

  // Display page list
  function displayPages(pages) {
    allPages = [...pages];
    filteredPages = [...pages];
    sortAndDisplayPages();
  }

  // Display filtered pages
  function displayFilteredPages(pages) {
    if (pages.length > 0) {
      noPages.style.display = 'none';
      pagesContainer.innerHTML = '';

      pages.forEach(page => {
        const pageCard = document.createElement('div');
        pageCard.className = 'page-card';
        pageCard.dataset.url = page.url;

        // Use saved title or try to extract title from URL
        let pageTitle = page.title || getMessage('noTitle', '(No title)');
        if (!pageTitle || pageTitle === '' || pageTitle === getMessage('noTitle', '(No title)')) {
          try {
            const urlObj = new URL(page.url);
            pageTitle = urlObj.hostname + urlObj.pathname;
          } catch (e) {
            pageTitle = page.url;
          }
        }

        // Format last updated date
        let lastUpdated = getMessage('unknown', 'Unknown');
        if (page.lastUpdated) {
          try {
            const date = new Date(page.lastUpdated);
            const locale = browserAPI.i18n.getUILanguage ? browserAPI.i18n.getUILanguage() : 'en';
            lastUpdated = date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
          } catch (e) {
            lastUpdated = page.lastUpdated;
          }
        }

        // Page Header
        const pageHeader = document.createElement('div');
        pageHeader.className = 'page-header';

        const favicon = document.createElement('img');
        favicon.className = 'page-favicon';
        try {
          favicon.src = `https://www.google.com/s2/favicons?domain=${new URL(page.url).hostname}&sz=32`;
        } catch (e) {
          favicon.src = 'images/icon16.png';
        }
        favicon.onerror = () => { favicon.src = 'images/icon16.png'; };

        const titleGroup = document.createElement('div');
        titleGroup.className = 'page-title-group';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'page-title';
        titleDiv.textContent = pageTitle;

        const urlDiv = document.createElement('div');
        urlDiv.className = 'page-url';
        urlDiv.textContent = page.url;

        titleGroup.appendChild(titleDiv);
        titleGroup.appendChild(urlDiv);

        const badge = document.createElement('div');
        badge.className = 'highlight-badge';
        badge.textContent = page.highlightCount;

        pageHeader.appendChild(favicon);
        pageHeader.appendChild(titleGroup);
        pageHeader.appendChild(badge);

        // Preview (most recent or first highlight)
        const previewDiv = document.createElement('div');
        previewDiv.className = 'page-preview';
        const latestHighlight = page.highlights[0]?.text || '';
        previewDiv.textContent = latestHighlight || getMessage('noHighlights', 'No text content.');

        // Page Footer
        const pageFooter = document.createElement('div');
        pageFooter.className = 'page-footer';

        const metaDiv = document.createElement('div');
        metaDiv.className = 'page-meta';
        metaDiv.textContent = lastUpdated;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'page-actions';

        const viewBtn = document.createElement('button');
        viewBtn.className = 'btn btn-view';
        viewBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
          ${getMessage('openPage', 'Open')}
        `;
        actionsDiv.appendChild(viewBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-delete';
        deleteBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        `;
        actionsDiv.appendChild(deleteBtn);

        pageFooter.appendChild(metaDiv);
        pageFooter.appendChild(actionsDiv);

        pageCard.appendChild(pageHeader);
        pageCard.appendChild(previewDiv);
        pageCard.appendChild(pageFooter);

        pagesContainer.appendChild(pageCard);

        // Open page button event
        viewBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          browserAPI.tabs.create({ url: page.url });
        });

        // Delete page button event
        deleteBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          const confirmMessage = getMessage('confirmDeletePage', 'Delete all highlights for this page?');
          if (confirm(confirmMessage)) {
            deletePageHighlights(page.url);
          }
        });

        // Click on card opens details (future implementation or just open URL)
        pageCard.addEventListener('click', () => {
          browserAPI.tabs.create({ url: page.url });
        });
      });
    } else {
      noPages.style.display = 'block';
      pagesContainer.innerHTML = '';
      pagesContainer.appendChild(noPages);
    }
  }

  // Delete all highlights for a page
  function deletePageHighlights(url) {
    browserAPI.runtime.sendMessage({
      action: 'clearAllHighlights',
      url: url,
      notifyRefresh: false  // No need to notify as we're not on the page
    }, (response) => {
      if (response && response.success) {
        debugLog('All highlights cleared through background for page:', url);
        loadAllHighlightedPages();  // Refresh the page list
      } else {
        debugLog('Error clearing highlights:', response);
      }
    });
  }

  // Function to delete all highlighted pages
  function deleteAllPages() {
    browserAPI.runtime.sendMessage({ action: 'deleteAllHighlightedPages' }, (response) => {
      if (response && response.success) {
        debugLog('All pages deleted successfully, count:', response.deletedCount);
        // Clear the UI immediately without reloading from storage
        displayPages([]);
      } else {
        debugLog('Error deleting all pages:', response);
        // On error, refresh the list to show current state
        loadAllHighlightedPages();
      }
    });
  }

  // Initialization
  localizeStaticElements();  // Localize static elements

  // 버튼 DOM 요소 가져오기 (이제 HTML에서 직접 생성)
  const deleteAllBtn = document.getElementById('delete-all-btn');
  const refreshBtn = document.getElementById('refresh-btn');
  const exportAllBtn = document.getElementById('export-all-btn');
  const importBtn = document.getElementById('import-btn');
  const importFileInput = document.getElementById('import-file');
  const searchToggleBtn = document.getElementById('search-toggle-btn');
  const searchInput = document.getElementById('search-input');
  const sortBtn = document.getElementById('sort-btn');

  // Search and sort state
  let allPages = [];
  let filteredPages = [];
  let currentSortMode = 'timeDesc'; // 'timeDesc' or 'timeAsc'

  // Import highlights event
  if (importBtn && importFileInput) {
    importBtn.addEventListener('click', function () {
      importFileInput.value = '';
      importFileInput.click();
    });

    importFileInput.addEventListener('change', function (event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          const json = JSON.parse(e.target.result);
          if (!json.pages || !Array.isArray(json.pages)) {
            alert(getMessage('importInvalidFormat', 'Invalid import file format.'));
            return;
          }
          // Filter out pages with unsafe URLs
          const safePages = json.pages.filter(page => isSafeOpenUrl(page.url));
          const skippedCount = json.pages.length - safePages.length;
          if (skippedCount > 0) {
            alert(getMessage('importUnsafeUrlSkipped', `${skippedCount} page(s) with invalid or unsafe URLs were skipped.`, [skippedCount]));
          }
          if (safePages.length === 0) {
            alert(getMessage('importAllUnsafeUrl', 'No pages could be imported because all URLs are invalid or unsafe.'));
            return;
          }
          // Get all current storage to check for overlap
          browserAPI.runtime.sendMessage({ action: 'getAllHighlightedPages' }, (response) => {
            if (response && response.success) {
              const existingUrls = response.pages.map(p => p.url);
              const importUrls = safePages.map(p => p.url);
              const overlap = importUrls.filter(url => existingUrls.includes(url));
              let proceed = true;
              if (overlap.length > 0) {
                const confirmMsg = getMessage('importOverwriteConfirm', 'Some pages already have highlights. Existing highlights for those pages will be deleted and replaced with imported data. Proceed?');
                proceed = confirm(confirmMsg);
              }
              if (!proceed) return;
              // Prepare operations: delete old, add new
              const ops = {};
              overlap.forEach(url => {
                ops[url] = null;
                ops[`${url}_meta`] = null;
              });
              safePages.forEach(page => {
                ops[page.url] = page.highlights || [];
                ops[`${page.url}_meta`] = {
                  title: page.title || '',
                  lastUpdated: page.lastUpdated || new Date().toISOString()
                };
              });
              browserAPI.storage.local.set(ops, () => {
                alert(getMessage('importSuccess', 'Import completed.'));
                loadAllHighlightedPages();
              });
            } else {
              alert(getMessage('importError', 'Error checking existing highlights.'));
            }
          });
        } catch (err) {
          alert(getMessage('importInvalidFormat', 'Invalid import file format.'));
        }
      };
      reader.readAsText(file);
    });
  }

  // Search toggle event
  if (searchToggleBtn && searchInput) {
    searchToggleBtn.addEventListener('click', function () {
      const isVisible = searchInput.style.display !== 'none';
      if (isVisible) {
        searchInput.style.display = 'none';
        searchInput.value = '';
        filterPages(''); // Reset filter
      } else {
        searchInput.style.display = 'block';
        searchInput.focus();
      }
    });

    // Search input event
    searchInput.addEventListener('input', function () {
      filterPages(this.value);
    });

    // Handle escape key to close search
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        searchInput.style.display = 'none';
        searchInput.value = '';
        filterPages('');
      }
    });
  }

  // Sort button event
  if (sortBtn) {
    sortBtn.addEventListener('click', function () {
      currentSortMode = currentSortMode === 'timeDesc' ? 'timeAsc' : 'timeDesc';

      // Update button appearance and tooltip
      if (currentSortMode === 'timeAsc') {
        sortBtn.innerHTML = `<svg viewBox="0 0 24 24">
          <path d="M3 6h6v2H3V6zm0 5h12v2H3v-2zm0 5h18v2H3v-2z"/>
        </svg>`;
        sortBtn.title = getMessage('sortOldestFirst', 'Sort by time (oldest first)');
        sortBtn.classList.add('sort-active');
      } else {
        sortBtn.innerHTML = `<svg viewBox="0 0 24 24">
          <path d="M3 6h18v2H3V6zm0 5h12v2H3v-2zm0 5h6v2H3v-2z"/>
        </svg>`;
        sortBtn.title = getMessage('sortNewestFirst', 'Sort by time (newest first)');
        sortBtn.classList.remove('sort-active');
      }

      sortAndDisplayPages();
    });
  }

  // Export all highlights event
  if (exportAllBtn) {
    exportAllBtn.addEventListener('click', function () {
      browserAPI.runtime.sendMessage({ action: 'getAllHighlightedPages' }, (response) => {
        if (response && response.success) {
          const exportData = response.pages;
          if (exportData.length === 0) {
            alert(getMessage('noHighlightsToExport', 'No highlights to export.'));
            return;
          }
          const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), pages: exportData }, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'all-highlights-' + new Date().getTime() + '.json';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else {
          alert(getMessage('exportError', 'Error exporting highlights.'));
        }
      });
    });
  }

  // Delete All 버튼 이벤트 연결
  if (deleteAllBtn) {
    deleteAllBtn.addEventListener('click', function () {
      const confirmMessage = getMessage('confirmDeleteAllPages', 'Delete ALL highlighted pages?');
      if (confirm(confirmMessage)) {
        deleteAllPages();
      }
    });
  }

  // Refresh 버튼 이벤트 연결
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function () {
      loadAllHighlightedPages();
    });
  }

  // 메시지로 페이지 목록 새로고침
  browserAPI.runtime.onMessage.addListener(function (request) {
    if (request.action === 'refreshPagesList') {
      loadAllHighlightedPages();
    }
  });

  loadAllHighlightedPages();
});
