document.addEventListener('DOMContentLoaded', () => {
  // Global reference to the browser API
  const browserAPI = typeof chrome !== 'undefined' ? chrome : (typeof browser !== 'undefined' ? browser : {});

  // Debug logging
  const DEBUG_MODE = false;
  function debugLog(...args) {
    if (DEBUG_MODE) {
      console.log('[PagesList]', ...args);
    }
  }

  // Load i18n messages
  function getMessage(key, defaultValue, substitutions) {
    if (browserAPI.i18n && browserAPI.i18n.getMessage) {
      const message = browserAPI.i18n.getMessage(key, substitutions);
      return message || defaultValue;
    }
    return defaultValue;
  }

  // Localize static elements
  function localizeStaticElements() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.textContent = getMessage(key, el.textContent);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.placeholder = getMessage(key, el.placeholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      el.title = getMessage(key, el.title);
    });

    // Remove preload class to enable transitions after localization
    setTimeout(() => {
      document.body.classList.remove('preload');
    }, 100);
  }

  // Helper to validate if a URL is safe to open (prevent script injection)
  function isSafeOpenUrl(url) {
    if (!url) return false;
    const lowerUrl = url.toLowerCase();
    return lowerUrl.startsWith('http://') ||
           lowerUrl.startsWith('https://') ||
           lowerUrl.startsWith('file://') ||
           lowerUrl.startsWith('ftp://');
  }

  // Load all highlighted pages from storage
  function loadAllHighlightedPages() {
    browserAPI.runtime.sendMessage({ action: 'getAllHighlightedPages' }, (response) => {
      if (response && response.success) {
        allPages = response.pages;
        sortAndDisplayPages();
      } else {
        debugLog('Error loading highlighted pages:', response);
      }
    });
  }

  // Filter pages based on search input
  function filterPages(query) {
    const lowerQuery = query.toLowerCase();
    filteredPages = allPages.filter(page => {
      const titleMatch = page.title && page.title.toLowerCase().includes(lowerQuery);
      const urlMatch = page.url && page.url.toLowerCase().includes(lowerQuery);
      const highlightMatch = page.highlights && page.highlights.some(h =>
        h.text && h.text.toLowerCase().includes(lowerQuery)
      );
      return titleMatch || urlMatch || highlightMatch;
    });
    sortAndDisplayPages();
  }

  // Sort and display pages
  function sortAndDisplayPages() {
    const pagesToSort = filteredPages.length > 0 || (document.getElementById('search-input') && document.getElementById('search-input').value) ? filteredPages : allPages;

    pagesToSort.sort((a, b) => {
      const timeA = new Date(a.lastUpdated || 0).getTime();
      const timeB = new Date(b.lastUpdated || 0).getTime();
      return currentSortMode === 'timeDesc' ? timeB - timeA : timeA - timeB;
    });

    displayPages(pagesToSort);
  }

  // Display pages in the UI
  function displayPages(pages) {
    const pagesContainer = document.getElementById('pages-container');
    const noPages = document.getElementById('no-pages');

    if (pages.length > 0) {
      if (noPages) noPages.style.display = 'none';
      pagesContainer.innerHTML = '';

      pages.forEach(page => {
        const pageCard = document.createElement('div');
        pageCard.className = 'page-card';

        // Get domain for favicon
        let domain = '';
        try {
          if (page.url.startsWith('file://')) {
            domain = 'Local File';
          } else {
            domain = new URL(page.url).hostname;
          }
        } catch (e) {
          domain = page.url;
        }

        const lastUpdatedDate = new Date(page.lastUpdated).toLocaleDateString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        // Use first highlight as preview if available
        const previewText = page.highlights && page.highlights.length > 0
          ? page.highlights[0].text
          : 'No preview available';

        pageCard.innerHTML = `
          <div class="page-header">
            <img class="page-favicon" src="https://www.google.com/s2/favicons?sz=64&domain=${domain}" onerror="this.src='images/icon48.png'">
            <div class="page-title-group">
              <div class="page-title" title="${page.title || 'Untitled'}">${page.title || 'Untitled'}</div>
              <div class="page-url" title="${page.url}">${page.url}</div>
            </div>
            <div class="highlight-badge">${page.highlights ? page.highlights.length : 0}</div>
          </div>
          <div class="page-preview">${previewText}</div>
          <div class="page-footer">
            <div class="page-meta">${lastUpdatedDate}</div>
            <div class="page-actions">
              <button class="btn btn-delete" title="${getMessage('delete', 'Delete')}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
              <button class="btn btn-view">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
                <span data-i18n="openPage">Open</span>
              </button>
            </div>
          </div>
        `;

        // Localize "Open" button text immediately since it was added via innerHTML
        const openSpan = pageCard.querySelector('[data-i18n="openPage"]');
        if (openSpan) openSpan.textContent = getMessage('openPage', 'Open');

        pagesContainer.appendChild(pageCard);

        const viewBtn = pageCard.querySelector('.btn-view');
        const deleteBtn = pageCard.querySelector('.btn-delete');

        // Sort highlights within the page by their position (from origin/main)
        if (page.highlights && page.highlights.length > 0) {
          page.highlights.sort((a, b) => {
            const posA = a.spans && a.spans[0] ? a.spans[0].position : 0;
            const posB = b.spans && b.spans[0] ? b.spans[0].position : 0;
            return posA - posB;
          });
        }

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
      if (noPages) noPages.style.display = 'block';
      pagesContainer.innerHTML = '';
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

  // Search input event
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      filterPages(this.value);
    });
  }

  // Sort button event
  if (sortBtn) {
    sortBtn.addEventListener('click', function () {
      currentSortMode = currentSortMode === 'timeDesc' ? 'timeAsc' : 'timeDesc';

      // Update button appearance and tooltip
      if (currentSortMode === 'timeAsc') {
        sortBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="18" x2="21" y2="18"></line>
          <line x1="3" y1="12" x2="15" y2="12"></line>
          <line x1="3" y1="6" x2="9" y2="6"></line>
        </svg>`;
        sortBtn.title = getMessage('sortOldestFirst', 'Sort by time (oldest first)');
      } else {
        sortBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="12" x2="15" y2="12"></line>
          <line x1="3" y1="18" x2="9" y2="18"></line>
        </svg>`;
        sortBtn.title = getMessage('sortNewestFirst', 'Sort by time (newest first)');
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
