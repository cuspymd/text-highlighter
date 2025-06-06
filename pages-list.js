document.addEventListener('DOMContentLoaded', function () {
  const pagesContainer = document.getElementById('pages-container');
  const noPages = document.getElementById('no-pages');

  // Set debug mode - change to true during development
  const DEBUG_MODE = false;

  // Debug log function
  function debugLog(...args) {
    if (DEBUG_MODE) {
      console.log(...args);
    }
  }

  // Function to get messages for multi-language support
  function getMessage(key, defaultValue = '') {
    if (typeof chrome !== 'undefined' && chrome.i18n) {
      return chrome.i18n.getMessage(key) || defaultValue;
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
  }

  // Load all highlighted pages data
  function loadAllHighlightedPages() {
    chrome.storage.local.get(null, (result) => {
      const pages = [];

      // Filter items with URLs as keys from storage (exclude metadata)
      for (const key in result) {
        if (Array.isArray(result[key]) && result[key].length > 0 && !key.endsWith('_meta')) {
          const url = key;
          const metaKey = `${url}_meta`;
          const metadata = result[metaKey] || {};

          pages.push({
            url: url,
            highlights: result[url],
            highlightCount: result[url].length,
            title: metadata.title || '',
            lastUpdated: metadata.lastUpdated || ''
          });
        }
      }

      debugLog('Loaded all highlighted pages:', pages);

      // Sort pages by most recent update
      pages.sort((a, b) => {
        // Treat pages without lastUpdated as oldest
        if (!a.lastUpdated) return 1;
        if (!b.lastUpdated) return -1;

        // Sort in descending order (newest date first)
        return new Date(b.lastUpdated) - new Date(a.lastUpdated);
      });

      // Display page list
      displayPages(pages);
    });
  }

  // Display page list
  function displayPages(pages) {
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
            const locale = chrome.i18n.getUILanguage ? chrome.i18n.getUILanguage() : 'en';
            lastUpdated = date.toLocaleString(locale);
          } catch (e) {
            lastUpdated = page.lastUpdated;
          }
        }

        const pageContent = `
          <div class="page-info-container">
            <div class="page-title">${pageTitle}</div>
            <div class="page-url">${page.url}</div>
            <div class="page-info">${getMessage('highlightCount', 'Highlights')}: ${page.highlightCount} | ${getMessage('lastUpdated', 'Last Updated')}: ${lastUpdated}</div>
          </div>
          <div class="page-actions">
            <button class="btn btn-details">${getMessage('showDetails', 'Show Details')}</button>
            <button class="btn btn-view">${getMessage('openPage', 'Open Page')}</button>
            <button class="btn btn-delete">${getMessage('deletePage', 'Delete')}</button>
          </div>
          <div class="page-highlights"></div>
        `;

        pageItem.innerHTML = pageContent;
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
              // Truncate text if too long
              let displayText = group.text;
              if (displayText.length > 100) {
                displayText = displayText.substring(0, 97) + '...';
              }
              highlightItem.innerHTML = `<span class="highlight-text">${displayText}</span>`;
              highlightsContainer.appendChild(highlightItem);
            });
          }
        });

        // Open page button event
        pageItem.querySelector('.btn-view').addEventListener('click', function () {
          chrome.tabs.create({ url: page.url });
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
    chrome.runtime.sendMessage({
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

  // Initialization
  localizeStaticElements();  // Localize static elements
  loadAllHighlightedPages();
});
