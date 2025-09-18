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
  const debugLog = DEBUG_MODE ? console.log.bind(console) : () => {};

  // Function to get messages for multi-language support
  function getMessage(key, defaultValue = '') {
    if (typeof chrome !== 'undefined' && browserAPI.i18n) {
      return browserAPI.i18n.getMessage(key) || defaultValue;
    }
    return defaultValue;
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
        const pageItem = document.createElement('div');
        pageItem.className = 'page-item';
        pageItem.dataset.url = page.url;

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
            // Determine date format based on current language
            const locale = browserAPI.i18n.getUILanguage ? browserAPI.i18n.getUILanguage() : 'en';
            lastUpdated = date.toLocaleString(locale);
          } catch (e) {
            lastUpdated = page.lastUpdated;
          }
        }

        // Build DOM safely to avoid XSS (no innerHTML)
        const infoContainer = document.createElement('div');
        infoContainer.className = 'page-info-container';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'page-title';
        titleDiv.textContent = pageTitle;

        const urlDiv = document.createElement('div');
        urlDiv.className = 'page-url';
        urlDiv.textContent = page.url;

        const infoDiv = document.createElement('div');
        infoDiv.className = 'page-info';
        infoDiv.textContent = `${getMessage('highlightCount', 'Highlights')}: ${page.highlightCount} | ${getMessage('lastUpdated', 'Last Updated')}: ${lastUpdated}`;

        infoContainer.appendChild(titleDiv);
        infoContainer.appendChild(urlDiv);
        infoContainer.appendChild(infoDiv);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'page-actions';

        const detailsBtn = document.createElement('button');
        detailsBtn.className = 'btn btn-details';
        detailsBtn.textContent = getMessage('showDetails', 'Show Details');
        actionsDiv.appendChild(detailsBtn);

        const viewBtn = document.createElement('button');
        viewBtn.className = 'btn btn-view';
        viewBtn.textContent = getMessage('openPage', 'Open Page');
        actionsDiv.appendChild(viewBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-delete';
        deleteBtn.textContent = getMessage('deletePage', 'Delete');
        actionsDiv.appendChild(deleteBtn);

        const highlightsDiv = document.createElement('div');
        highlightsDiv.className = 'page-highlights';

        pageItem.appendChild(infoContainer);
        pageItem.appendChild(actionsDiv);
        pageItem.appendChild(highlightsDiv);

        pagesContainer.appendChild(pageItem);

        // Page details button event
        pageItem.querySelector('.btn-details').addEventListener('click', function () {
          const highlightsContainer = pageItem.querySelector('.page-highlights');

          if (highlightsContainer.style.display === 'block') {
            highlightsContainer.style.display = 'none';
            this.textContent = getMessage('showDetails', 'Show Details');
          } else {
            // Display highlight data
            highlightsContainer.innerHTML = '';
            highlightsContainer.style.display = 'block';
            this.textContent = getMessage('hideDetails', 'Hide');

            // 그룹 구조이므로 대표 span의 position 기준 정렬
            page.highlights.sort((a, b) => {
              const posA = a.spans && a.spans[0] ? a.spans[0].position : 0;
              const posB = b.spans && b.spans[0] ? b.spans[0].position : 0;
              return posA - posB;
            });

            page.highlights.forEach(group => {
              const highlightItem = document.createElement('div');
              highlightItem.className = 'highlight-item';
              highlightItem.style.backgroundColor = group.color;
              const span = document.createElement('span');
              span.className = 'highlight-text';
              span.textContent = group.text;
              highlightItem.appendChild(span);
              highlightsContainer.appendChild(highlightItem);
            });
          }
        });

        // Open page button event
        pageItem.querySelector('.btn-view').addEventListener('click', function () {
          browserAPI.tabs.create({ url: page.url });
        });

        // Delete page button event
        pageItem.querySelector('.btn-delete').addEventListener('click', function () {
          const confirmMessage = getMessage('confirmDeletePage', 'Delete all highlights for this page?');
          if (confirm(confirmMessage)) {
            deletePageHighlights(page.url);
          }
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
          // Get all current storage to check for overlap
          browserAPI.runtime.sendMessage({ action: 'getAllHighlightedPages' }, (response) => {
            if (response && response.success) {
              const existingUrls = response.pages.map(p => p.url);
              const importUrls = json.pages.map(p => p.url);
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
              json.pages.forEach(page => {
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
  browserAPI.runtime.onMessage.addListener(function(request) {
    if (request.action === 'refreshPagesList') {
      loadAllHighlightedPages();
    }
  });

  loadAllHighlightedPages();
});
