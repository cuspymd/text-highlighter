import { browserAPI } from './shared/browser-api.js';
import { debugLog } from './shared/logger.js';
import { validateImportPayload } from './shared/import-export-schema.js';
import { createLocalizedModalHelpers } from './shared/modal.js';
import { sendToBackground } from './shared/runtime-message.js';
import { initializeThemeWatcher } from './shared/theme.js';
import { openHighlight } from './shared/highlight-navigation.js';
import { copyTextToClipboard } from './shared/clipboard.js';
import {
  copyableHighlights,
  formatPageMarkdown,
  formatPagesMarkdown,
  sortHighlightsByPosition,
} from './shared/highlight-copy.js';

document.addEventListener('DOMContentLoaded', function () {
  // Initialize theme watcher
  initializeThemeWatcher();

  // Activate transition after page load completion
  setTimeout(() => {
    document.body.classList.remove('preload');
  }, 50);

  const pagesContainer = document.getElementById('pages-container');
  const noPages = document.getElementById('no-pages');
  const searchSummary = document.getElementById('search-summary');
  const searchSummaryRow = document.getElementById('search-summary-row');
  const copySearchResultsBtn = document.getElementById('copy-search-results-btn');
  const copyStatus = document.getElementById('copy-status');
  const navigationStatus = document.getElementById('navigation-status');
  let navigationController = null;
  let copyQueue = Promise.resolve();
  const copyFeedbackTimers = new WeakMap();
  window.addEventListener('pagehide', () => navigationController?.abort(), { once: true });

  async function navigateToHighlight(item, page, group) {
    if (item.getAttribute('aria-busy') === 'true') return;
    navigationController?.abort();
    const controller = new AbortController();
    navigationController = controller;
    item.setAttribute('aria-busy', 'true');
    navigationStatus.textContent = getMessage('highlightNavigationLoading', 'Opening highlight…');
    const result = await openHighlight(page.url, group.groupId, { signal: controller.signal });
    item.removeAttribute('aria-busy');
    if (navigationController !== controller || controller.signal.aborted) return;
    const key = result.success ? 'highlightNavigationSuccess'
      : result.reason === 'not-found' ? 'highlightNavigationMissing'
      : result.reason === 'cancelled' ? 'highlightNavigationCancelled' : 'highlightNavigationUnavailable';
    navigationStatus.textContent = getMessage(key);
    navigationController = null;
  }

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

  const { showConfirmModal, showAlertModal } = createLocalizedModalHelpers(getMessage);
  const copyIconSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/></svg>';
  copySearchResultsBtn.innerHTML = copyIconSvg;
  const expandAllIconSvg = '<svg viewBox="0 0 24 24"><path d="M7 5h10v2H7V5Zm-4 4h18v2H3V9Zm4 4h10v2H7v-2Zm-4 4h18v2H3v-2Z"/></svg>';
  const collapseAllIconSvg = '<svg viewBox="0 0 24 24"><path d="M3 5h18v2H3V5Zm4 4h10v2H7V9Zm-4 4h18v2H3v-2Zm4 4h10v2H7v-2Z"/></svg>';
  const webProtocols = new Set(['http:', 'https:']);
  const fallbackWebFavicon = `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#e5e7eb" stroke="#9ca3af"/><path d="M2 8h12M8 1a11 11 0 0 0 0 14M8 1a11 11 0 0 1 0 14" stroke="#6b7280" stroke-width="1" fill="none"/></svg>'
  )}`;
  const fallbackFileFavicon = `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M4 1.5h5l3 3V14.5H4z" fill="#dbeafe" stroke="#60a5fa"/><path d="M9 1.5v3h3" fill="#bfdbfe" stroke="#60a5fa"/><path d="M5.5 8.5h5M5.5 10.5h5M5.5 12.5h3.5" stroke="#3b82f6" stroke-width="1"/></svg>'
  )}`;
  const fallbackGenericFavicon = `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="#f3f4f6" stroke="#9ca3af"/><path d="M5 6h6M5 8h6M5 10h4" stroke="#6b7280" stroke-width="1.2"/></svg>'
  )}`;

  function getPageFaviconConfig(urlString) {
    try {
      const parsed = new URL(urlString);

      if (webProtocols.has(parsed.protocol) && parsed.hostname) {
        return {
          src: `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(parsed.hostname)}`,
          fallbackSrc: fallbackWebFavicon,
        };
      }

      if (parsed.protocol === 'file:') {
        return { src: fallbackFileFavicon, fallbackSrc: fallbackFileFavicon };
      }

      return { src: fallbackGenericFavicon, fallbackSrc: fallbackGenericFavicon };
    } catch (e) {
      return { src: fallbackGenericFavicon, fallbackSrc: fallbackGenericFavicon };
    }
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

  function copyFormatOptions() {
    return {
      fallbackTitle: getMessage('noTitle', '(No title)'),
    };
  }

  // Copies run one at a time so a slow clipboard write cannot finish after a
  // later one and leave the clipboard holding the older text.
  function copyMarkdown(text, button, successMessage) {
    if (!text) return copyQueue;
    copyQueue = copyQueue.then(() => runCopyMarkdown(text, button, successMessage)).catch(() => {});
    return copyQueue;
  }

  async function runCopyMarkdown(text, button, successMessage) {
    copyStatus.textContent = '';
    const copied = await copyTextToClipboard(text);
    if (!copied) {
      clearTimeout(copyFeedbackTimers.get(button));
      button.classList.remove('is-copied');
      await showAlertModal(getMessage('copyHighlightsFailed', 'Could not copy the highlights. Please try again.'));
      return;
    }

    copyStatus.textContent = successMessage;
    button.classList.add('is-copied');
    clearTimeout(copyFeedbackTimers.get(button));
    copyFeedbackTimers.set(button, setTimeout(() => button.classList.remove('is-copied'), 1500));
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
  async function loadAllHighlightedPages() {
    const response = await sendToBackground({ action: 'getAllHighlightedPages' });

    if (response && response.success) {
      debugLog('Received all highlighted pages from background:', response.pages);
      displayPages(response.pages);
    } else {
      debugLog('Error loading highlighted pages:', response);
      displayPages([]);
    }
  }

  function normalizeSearchTerm(searchTerm) {
    return (searchTerm || '').trim().toLowerCase();
  }

  function appendHighlightedText(container, text, searchTerm) {
    const sourceText = text || '';
    const normalizedTerm = normalizeSearchTerm(searchTerm);

    if (!normalizedTerm) {
      container.textContent = sourceText;
      return;
    }

    const lowerText = sourceText.toLowerCase();
    let startIndex = 0;
    let matchIndex = lowerText.indexOf(normalizedTerm, startIndex);

    if (matchIndex === -1) {
      container.textContent = sourceText;
      return;
    }

    while (matchIndex !== -1) {
      if (matchIndex > startIndex) {
        container.appendChild(document.createTextNode(sourceText.slice(startIndex, matchIndex)));
      }

      const mark = document.createElement('mark');
      mark.className = 'search-match';
      mark.textContent = sourceText.slice(matchIndex, matchIndex + normalizedTerm.length);
      container.appendChild(mark);

      startIndex = matchIndex + normalizedTerm.length;
      matchIndex = lowerText.indexOf(normalizedTerm, startIndex);
    }

    if (startIndex < sourceText.length) {
      container.appendChild(document.createTextNode(sourceText.slice(startIndex)));
    }
  }

  function renderPageHighlights(page, highlightsContainer, searchTerm, showAll = false) {
    highlightsContainer.replaceChildren();
    highlightsContainer.dataset.complete = 'true';

    const sortedHighlights = sortHighlightsByPosition(page.highlights);

    if (sortedHighlights.length === 0) {
      const emptyHighlight = document.createElement('div');
      emptyHighlight.className = 'highlight-item';
      const emptyText = document.createElement('span');
      emptyText.className = 'highlight-text';
      emptyText.textContent = getMessage('noHighlights', 'No highlighted text on this page.');
      emptyHighlight.appendChild(emptyText);
      highlightsContainer.appendChild(emptyHighlight);
      return;
    }

    const term = normalizeSearchTerm(searchTerm);
    const matches = [];
    const others = [];
    sortedHighlights.forEach(group => {
      ((group.text || '').toLowerCase().includes(term) ? matches : others).push(group);
    });
    const visible = term ? (showAll ? [...matches, ...others] : matches) : sortedHighlights;
    highlightsContainer.dataset.complete = String(!term || showAll || others.length === 0);

    visible.forEach(group => {
      const highlightItem = document.createElement('div');
      highlightItem.className = 'highlight-item';
      highlightItem.style.setProperty('--highlight-color', group.color);
      const highlightMain = document.createElement('div');
      highlightMain.className = 'highlight-main';
      const span = document.createElement('span');
      span.className = 'highlight-text';
      appendHighlightedText(span, group.text, searchTerm);
      highlightMain.appendChild(span);
      if (isSafeOpenUrl(page.url) && group.groupId != null) {
        highlightMain.setAttribute('role', 'button');
        highlightMain.tabIndex = 0;
        highlightMain.title = getMessage('openHighlight', 'Open highlight in original page');
        highlightMain.addEventListener('click', () => {
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed && selection.containsNode(highlightMain, true)) return;
          navigateToHighlight(highlightMain, page, group);
        });
        highlightMain.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            navigateToHighlight(highlightMain, page, group);
          }
        });
      }
      highlightItem.appendChild(highlightMain);
      highlightsContainer.appendChild(highlightItem);
    });
    if (term && others.length > 0) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'btn other-highlights-toggle';
      toggle.setAttribute('aria-expanded', String(showAll));
      toggle.textContent = showAll ? getMessage('hideOtherHighlights', 'Hide other highlights')
        : getMessage('showOtherHighlights', 'Show $1 other highlights', [String(others.length)]);
      toggle.addEventListener('click', () => {
        renderPageHighlights(page, highlightsContainer, searchTerm, !showAll);
        highlightsContainer.querySelector('.other-highlights-toggle')?.focus();
        updateExpandCollapseAllButtonState();
      });
      highlightsContainer.appendChild(toggle);
    }
  }

  function setPageDetailsExpanded(pageItem, page, expand, searchTerm, showAll = true) {
    const highlightsContainer = pageItem.querySelector('.page-highlights');
    const detailsButton = pageItem.querySelector('.btn-details');

    if (!expand) {
      highlightsContainer.style.display = 'none';
      detailsButton.textContent = getMessage('showDetails', 'Show Details');
      return;
    }

    renderPageHighlights(page, highlightsContainer, searchTerm, showAll);
    highlightsContainer.style.display = 'block';
    detailsButton.textContent = getMessage('hideDetails', 'Hide');
  }

  // Search functionality
  function filterPages(searchTerm) {
    expandAllActive = false;
    currentSearchTerm = searchTerm || '';

    const normalizedTerm = normalizeSearchTerm(searchTerm);

    if (!normalizedTerm) {
      filteredPages = [...allPages];
    } else {
      filteredPages = allPages.filter(page => {
        // Search in page title
        const titleMatch = (page.title || '').toLowerCase().includes(normalizedTerm);

        // Search in highlight text
        const highlightMatch = page.highlights && page.highlights.some(group =>
          group.text && group.text.toLowerCase().includes(normalizedTerm)
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
    expandAllActive = false;
    allPages = [...pages];
    filterPages(currentSearchTerm);
  }

  function getVisiblePageItems() {
    return Array.from(pagesContainer.querySelectorAll('.page-item'));
  }

  function areAllVisiblePagesExpanded() {
    const pageItems = getVisiblePageItems();
    return pageItems.length > 0 && pageItems.every(pageItem => {
      const highlightsContainer = pageItem.querySelector('.page-highlights');
      return highlightsContainer?.style.display === 'block' && highlightsContainer.dataset.complete === 'true';
    });
  }

  function updateExpandCollapseAllButtonState() {
    if (!expandAllBtn) return;

    const hasVisiblePages = getVisiblePageItems().length > 0;
    const allExpanded = areAllVisiblePagesExpanded();
    const titleKey = allExpanded ? 'collapseAllHighlights' : 'expandAllHighlights';
    const fallbackTitle = allExpanded ? 'Collapse all highlights' : 'Expand all highlights';

    expandAllBtn.disabled = !hasVisiblePages;
    expandAllBtn.setAttribute('aria-pressed', String(allExpanded));
    expandAllBtn.title = getMessage(titleKey, fallbackTitle);
    expandAllBtn.setAttribute('aria-label', expandAllBtn.title);
    expandAllBtn.innerHTML = allExpanded ? collapseAllIconSvg : expandAllIconSvg;
  }

  function expandAllVisiblePages() {
    if (filteredPages.length === 0) return;

    expandAllActive = true;
    sortAndDisplayPages();
  }

  function collapseAllVisiblePages() {
    expandAllActive = false;

    getVisiblePageItems().forEach(pageItem => {
      const page = filteredPages.find(item => item.url === pageItem.dataset.url);
      if (page) {
        setPageDetailsExpanded(pageItem, page, false, currentSearchTerm);
      }
    });

    updateExpandCollapseAllButtonState();
  }

  function toggleExpandCollapseAllVisiblePages() {
    if (areAllVisiblePagesExpanded()) {
      collapseAllVisiblePages();
      return;
    }

    expandAllVisiblePages();
  }

  // Display filtered pages
  function displayFilteredPages(pages) {
    const term = normalizeSearchTerm(currentSearchTerm);
    const matchCount = pages.reduce((count, page) => count + (page.highlights || [])
      .filter(group => (group.text || '').toLowerCase().includes(term)).length, 0);
    searchSummaryRow.hidden = !term;
    searchSummary.hidden = !term;
    searchSummary.textContent = term ? getMessage('highlightSearchSummary', '$1 pages · $2 matching highlights',
      [String(pages.length), String(matchCount)]) : '';
    copySearchResultsBtn.hidden = !term || matchCount === 0;
    copySearchResultsBtn.title = getMessage('copySearchResultsLabel', 'Copy matching highlights');
    copySearchResultsBtn.setAttribute('aria-label', copySearchResultsBtn.title);
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

        const titleRow = document.createElement('div');
        titleRow.className = 'page-title-row';

        const favicon = document.createElement('img');
        favicon.className = 'page-favicon';
        favicon.alt = '';
        const faviconConfig = getPageFaviconConfig(page.url);
        favicon.src = faviconConfig.src;
        favicon.addEventListener('error', () => {
          if (favicon.src !== faviconConfig.fallbackSrc) {
            favicon.src = faviconConfig.fallbackSrc;
          }
        }, { once: true });

        const titleDiv = document.createElement('div');
        titleDiv.className = 'page-title';
        appendHighlightedText(titleDiv, pageTitle, currentSearchTerm);

        const urlDiv = document.createElement('div');
        urlDiv.className = 'page-url';
        appendHighlightedText(urlDiv, page.url, currentSearchTerm);

        const infoDiv = document.createElement('div');
        infoDiv.className = 'page-info';
        infoDiv.textContent = `${getMessage('highlightCount', 'Highlights')}: ${page.highlightCount ?? 0} | ${getMessage('lastUpdated', 'Last Updated')}: ${lastUpdated}`;

        titleRow.appendChild(favicon);
        titleRow.appendChild(titleDiv);
        const pageCopyCount = copyableHighlights(page.highlights).length;
        if (pageCopyCount > 0) {
          const copyPageBtn = document.createElement('button');
          copyPageBtn.type = 'button';
          copyPageBtn.className = 'copy-icon-btn copy-page-btn';
          copyPageBtn.innerHTML = copyIconSvg;
          copyPageBtn.title = getMessage('copyPageHighlightsLabel', 'Copy all highlights from this page');
          copyPageBtn.setAttribute('aria-label', copyPageBtn.title);
          titleRow.appendChild(copyPageBtn);
          copyPageBtn.addEventListener('click', async () => {
            await copyMarkdown(
              formatPageMarkdown(page, page.highlights, copyFormatOptions()),
              copyPageBtn,
              getMessage('copyPageHighlightsSuccess', 'Copied $1 highlights from this page.', [String(pageCopyCount)]),
            );
          });
        }
        infoContainer.appendChild(titleRow);
        infoContainer.appendChild(urlDiv);
        infoContainer.appendChild(infoDiv);
        const titleOnlyMatch = term && !(page.highlights || []).some(group =>
          (group.text || '').toLowerCase().includes(term));
        if (titleOnlyMatch) {
          const label = document.createElement('div');
          label.className = 'title-match-label';
          label.textContent = getMessage('highlightTitleMatch', 'Title match');
          infoContainer.appendChild(label);
        }

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
        highlightsDiv.style.display = 'none';

        pageItem.appendChild(infoContainer);
        pageItem.appendChild(actionsDiv);
        pageItem.appendChild(highlightsDiv);

        pagesContainer.appendChild(pageItem);

        const shouldAutoExpand = expandAllActive || (Boolean(term) && !titleOnlyMatch);
        if (shouldAutoExpand) {
          setPageDetailsExpanded(pageItem, page, true, currentSearchTerm, expandAllActive);
        }

        // Page details button event
        pageItem.querySelector('.btn-details').addEventListener('click', function () {
          expandAllActive = false;
          const highlightsContainer = pageItem.querySelector('.page-highlights');
          const isExpanded = highlightsContainer.style.display === 'block';
          setPageDetailsExpanded(pageItem, page, !isExpanded, currentSearchTerm);
          updateExpandCollapseAllButtonState();
        });

        // Open page button event
        pageItem.querySelector('.btn-view').addEventListener('click', function () {
          browserAPI.tabs.create({ url: page.url });
        });

        // Delete page button event
        pageItem.querySelector('.btn-delete').addEventListener('click', async function () {
          const confirmMessage = getMessage('confirmDeletePage', 'Delete all highlights for this page?');
          const confirmed = await showConfirmModal(confirmMessage);
          if (confirmed) {
            deletePageHighlights(page.url);
          }
        });
      });
    } else {
      noPages.style.display = 'block';
      pagesContainer.innerHTML = '';
      pagesContainer.appendChild(noPages);
    }

    updateExpandCollapseAllButtonState();
  }

  // Delete all highlights for a page
  async function deletePageHighlights(url) {
    const response = await sendToBackground({
      action: 'clearAllHighlights',
      url: url,
      notifyRefresh: false  // No need to notify as we're not on the page
    });

    if (response && response.success) {
      debugLog('All highlights cleared through background for page:', url);
      await loadAllHighlightedPages();  // Refresh the page list
    } else {
      debugLog('Error clearing highlights:', response);
    }
  }

  // Function to delete all highlighted pages
  async function deleteAllPages() {
    const response = await sendToBackground({ action: 'deleteAllHighlightedPages' });

    if (response && response.success) {
      debugLog('All pages deleted successfully, count:', response.deletedCount);
      // Clear the UI immediately without reloading from storage
      displayPages([]);
    } else {
      debugLog('Error deleting all pages:', response);
      // On error, refresh the list to show current state
      await loadAllHighlightedPages();
    }
  }

  // Initialization
  localizeStaticElements();  // Localize static elements

  // Get button DOM elements (now created directly in HTML)
  const deleteAllBtn = document.getElementById('delete-all-btn');
  const refreshBtn = document.getElementById('refresh-btn');
  const expandAllBtn = document.getElementById('expand-all-btn');
  const exportAllBtn = document.getElementById('export-all-btn');
  const importBtn = document.getElementById('import-btn');
  const importFileInput = document.getElementById('import-file');
  const searchInput = document.getElementById('search-input');
  const sortBtn = document.getElementById('sort-btn');
  const moreMenuBtn = document.getElementById('more-menu-btn');
  const moreMenu = document.getElementById('more-menu');

  // Search and sort state
  let allPages = [];
  let filteredPages = [];
  let currentSortMode = 'timeDesc'; // 'timeDesc' or 'timeAsc'
  let currentSearchTerm = '';
  let expandAllActive = false;

  function setMoreMenuOpen(open) {
    if (!moreMenu || !moreMenuBtn) return;

    moreMenu.hidden = !open;
    moreMenuBtn.setAttribute('aria-expanded', String(open));
  }

  function closeMoreMenu() {
    setMoreMenuOpen(false);
  }

  if (moreMenuBtn) {
    moreMenuBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      setMoreMenuOpen(moreMenu ? moreMenu.hidden : false);
    });
  }

  document.addEventListener('click', function (event) {
    if (!moreMenu || !moreMenuBtn) return;

    const menuContainer = moreMenuBtn.closest('.more-menu-container');
    if (menuContainer && !menuContainer.contains(event.target)) {
      closeMoreMenu();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !moreMenu || moreMenu.hidden) return;

    closeMoreMenu();
    moreMenuBtn?.focus();
  });

  // Import highlights event
  if (importBtn && importFileInput) {
    importBtn.addEventListener('click', function () {
      closeMoreMenu();
      importFileInput.value = '';
      importFileInput.click();
    });

    importFileInput.addEventListener('change', function (event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async function (e) {
        try {
          const json = JSON.parse(e.target.result);
          if (!json.pages || !Array.isArray(json.pages)) {
            await showAlertModal(getMessage('importInvalidFormat', 'Invalid import file format.'));
            return;
          }
          // Filter out pages with unsafe URLs
          const safePages = json.pages.filter(page => isSafeOpenUrl(page.url));
          const skippedCount = json.pages.length - safePages.length;
          if (skippedCount > 0) {
            await showAlertModal(getMessage('importUnsafeUrlSkipped', `${skippedCount} page(s) with invalid or unsafe URLs were skipped.`, [skippedCount]));
          }
          if (safePages.length === 0) {
            await showAlertModal(getMessage('importAllUnsafeUrl', 'No pages could be imported because all URLs are invalid or unsafe.'));
            return;
          }

          // Validate and normalize schema before writing to storage.
          const validation = validateImportPayload({ pages: safePages });
          if (!validation.valid) {
            await showAlertModal(getMessage('importInvalidFormat', 'Invalid import file format.'));
            return;
          }

          if (validation.pages.length === 0) {
            await showAlertModal(getMessage('importAllInvalidSchema', 'No pages could be imported because all data failed schema validation.'));
            return;
          }

          const schemaDrops = validation.stats.rejectedPages + validation.stats.rejectedHighlights + validation.stats.rejectedSpans;
          if (schemaDrops > 0) {
            const schemaWarning = getMessage(
              'importSchemaInvalidItemsSkipped',
              '$1 invalid item(s) were skipped during import.',
              [String(schemaDrops)],
            );
            await showAlertModal(schemaWarning);
          }

          const validatedPages = validation.pages;

          // Get all current storage to check for overlap
          const existing = await sendToBackground({ action: 'getAllHighlightedPages' });
          if (!existing || !existing.success) {
            await showAlertModal(getMessage('importError', 'Error checking existing highlights.'));
            return;
          }

          const existingUrls = existing.pages.map(p => p.url);
          const importUrls = validatedPages.map(p => p.url);
          const overlap = importUrls.filter(url => existingUrls.includes(url));
          if (overlap.length > 0) {
            const confirmMsg = getMessage('importOverwriteConfirm', 'Some pages already have highlights. Existing highlights for those pages will be deleted and replaced with imported data. Proceed?');
            const proceed = await showConfirmModal(confirmMsg);
            if (!proceed) return;
          }

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

          await browserAPI.storage.local.set(ops);
          await showAlertModal(getMessage('importSuccess', 'Import completed.'));
          await loadAllHighlightedPages();
        } catch (err) {
          await showAlertModal(getMessage('importInvalidFormat', 'Invalid import file format.'));
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

    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        searchInput.value = '';
        filterPages('');
      }
    });
  }

  if (copySearchResultsBtn) {
    copySearchResultsBtn.addEventListener('click', async function () {
      const term = normalizeSearchTerm(currentSearchTerm);
      if (!term) return;
      const pages = filteredPages.map(page => ({
        ...page,
        highlights: (page.highlights || []).filter(group =>
          (group.text || '').toLowerCase().includes(term)),
      })).filter(page => page.highlights.length > 0);
      const count = pages.reduce((total, page) => total + page.highlights.length, 0);
      await copyMarkdown(
        formatPagesMarkdown(pages, copyFormatOptions()),
        copySearchResultsBtn,
        getMessage('copySearchResultsSuccess', 'Copied $1 matching highlights.', [String(count)]),
      );
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

  // Expand/collapse all currently visible page highlights
  if (expandAllBtn) {
    expandAllBtn.addEventListener('click', function () {
      toggleExpandCollapseAllVisiblePages();
    });
  }

  // Export all highlights event
  if (exportAllBtn) {
    exportAllBtn.addEventListener('click', async function () {
      closeMoreMenu();
      const response = await sendToBackground({ action: 'getAllHighlightedPages' });

      if (!response || !response.success) {
        await showAlertModal(getMessage('exportError', 'Error exporting highlights.'));
        return;
      }

      const exportData = response.pages;
      if (exportData.length === 0) {
        await showAlertModal(getMessage('noHighlightsToExport', 'No highlights to export.'));
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
    });
  }

  // Connect Delete All button events
  if (deleteAllBtn) {
    deleteAllBtn.addEventListener('click', async function () {
      const confirmMessage = getMessage('confirmDeleteAllPages', 'Delete ALL highlighted pages?');
      const confirmed = await showConfirmModal(confirmMessage);
      if (confirmed) {
        deleteAllPages();
      }
    });
  }

  // Connect Refresh button events
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function () {
      currentSearchTerm = '';
      expandAllActive = false;
      if (searchInput) {
        searchInput.value = '';
      }
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
