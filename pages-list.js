import { browserAPI } from './shared/browser-api.js';
import { debugLog } from './shared/logger.js';
import { validateImportPayload } from './shared/import-export-schema.js';

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

document.addEventListener('DOMContentLoaded', function () {
  // Initialize theme watcher
  initializeThemeWatcher();

  // Activate transition after page load completion
  setTimeout(() => {
    document.body.classList.remove('preload');
  }, 50);

  const pagesContainer = document.getElementById('pages-container');
  const noPages = document.getElementById('no-pages');

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

            // Since it's a group structure, sort by the position of the representative span
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

  // Get button DOM elements (now created directly in HTML)
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

          // Validate and normalize schema before writing to storage.
          const validation = validateImportPayload({ pages: safePages });
          if (!validation.valid) {
            alert(getMessage('importInvalidFormat', 'Invalid import file format.'));
            return;
          }

          if (validation.pages.length === 0) {
            alert(getMessage('importAllInvalidSchema', 'No pages could be imported because all data failed schema validation.'));
            return;
          }

          const schemaDrops = validation.stats.rejectedPages + validation.stats.rejectedHighlights + validation.stats.rejectedSpans;
          if (schemaDrops > 0) {
            const schemaWarning = getMessage(
              'importSchemaInvalidItemsSkipped',
              '$1 invalid item(s) were skipped during import.',
              [String(schemaDrops)],
            );
            alert(schemaWarning);
          }

          const validatedPages = validation.pages;

          // Get all current storage to check for overlap
          browserAPI.runtime.sendMessage({ action: 'getAllHighlightedPages' }, (response) => {
            if (response && response.success) {
              const existingUrls = response.pages.map(p => p.url);
              const importUrls = validatedPages.map(p => p.url);
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
              validatedPages.forEach(page => {
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

  // Connect Delete All button events
  if (deleteAllBtn) {
    deleteAllBtn.addEventListener('click', function () {
      const confirmMessage = getMessage('confirmDeleteAllPages', 'Delete ALL highlighted pages?');
      if (confirm(confirmMessage)) {
        deleteAllPages();
      }
    });
  }

  // Connect Refresh button events
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function () {
      loadAllHighlightedPages();
    });
  }

  // Refresh page list via message
  browserAPI.runtime.onMessage.addListener(function (request) {
    if (request.action === 'refreshPagesList') {
      loadAllHighlightedPages();
    }
  });

  loadAllHighlightedPages();
});
