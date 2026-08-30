import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import {
  loadPageScript,
  readPageBody,
  stubPageEnvironment,
} from './helpers/extension-page.js';

const PAGES_LIST_BODY = readPageBody(new URL('../pages-list.html', import.meta.url));

const OLDER = {
  url: 'https://example.com/older',
  title: 'Older article',
  lastUpdated: '2026-01-01T00:00:00.000Z',
  highlightCount: 2,
  highlights: [
    { groupId: 'a1', text: 'second sentence', color: '#ffd54f', spans: [{ position: 2 }] },
    { groupId: 'a2', text: 'first sentence', color: '#80cbc4', spans: [{ position: 1 }] },
  ],
};

const NEWER = {
  url: 'https://example.com/newer',
  title: 'Newer notes',
  lastUpdated: '2026-06-01T00:00:00.000Z',
  highlightCount: 1,
  highlights: [
    { groupId: 'b1', text: 'a quotable line', color: '#ef9a9a', spans: [{ position: 1 }] },
  ],
};

describe('pages-list', () => {
  let openPagesList;

  beforeAll(async () => {
    stubPageEnvironment();
    openPagesList = await loadPageScript(() => import('../pages-list.js'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = PAGES_LIST_BODY;

    chrome.i18n.getMessage.mockImplementation(key => key);
    chrome.runtime.getURL.mockImplementation(path => `chrome-extension://test/${path}`);
    respondToBackground(() => ({ success: true, pages: [OLDER, NEWER] }));
  });

  /**
   * Answer the page's background messages with `handler(message)`.
   *
   * The page still sends these in the callback form, so the mock answers both
   * ways: it calls the callback and returns the response as a promise. That
   * keeps these tests pointed at the behaviour rather than the call shape, so
   * moving the page to `await` does not rewrite them.
   */
  function respondToBackground(handler) {
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      const response = handler(message);
      if (typeof callback === 'function') callback(response);
      return Promise.resolve(response);
    });
  }

  // Let the page's awaited work - modal promises, async message callbacks -
  // run to completion before asserting.
  function flush() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  /**
   * Wait until `predicate` holds, one macrotask at a time.
   *
   * A single flush is enough for the page's own promises, but not for work that
   * hangs off a browser callback of its own - `FileReader` delivers on its own
   * schedule, and how many ticks that takes varies with what else the suite is
   * running. Leaving it unfinished lets the alert it raises land in the middle
   * of the next test.
   */
  async function waitFor(predicate, description) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (predicate()) return;
      await flush();
    }
    throw new Error(`Timed out waiting for ${description}`);
  }

  function backgroundMessages(action) {
    return chrome.runtime.sendMessage.mock.calls.filter(([message]) => message.action === action);
  }

  function pageItems() {
    return [...document.querySelectorAll('.page-item')];
  }

  function renderedUrls() {
    return pageItems().map(item => item.dataset.url);
  }

  function itemFor(url) {
    return pageItems().find(item => item.dataset.url === url);
  }

  function highlightTextsIn(item) {
    return [...item.querySelectorAll('.page-highlights .highlight-text')].map(el => el.textContent);
  }

  function isExpanded(item) {
    return item.querySelector('.page-highlights').style.display === 'block';
  }

  async function confirmModal(accept) {
    await flush();
    const button = document.querySelector(accept ? '.modal-confirm' : '.modal-cancel');
    expect(button).not.toBeNull();
    button.click();
    await flush();
  }

  function alertText() {
    return document.querySelector('.modal-content p')?.textContent ?? null;
  }

  // The page awaits each alert, so a run that raises one stops there until it is
  // acknowledged. Dismiss it to let the rest of the work continue.
  async function dismissAlert() {
    await flush();
    const button = document.querySelector('.modal-confirm');
    expect(button).not.toBeNull();
    button.click();
    await flush();
  }

  function typeSearch(term) {
    const input = document.getElementById('search-input');
    input.value = term;
    input.dispatchEvent(new Event('input'));
    return input;
  }

  // ===================================================================
  // Loading
  // ===================================================================

  describe('loading the list', () => {
    // The empty state lives inside the container the list clears, so rendering
    // pages takes it out of the document rather than hiding it in place. It is
    // put back by the branch below.
    it('renders an item per stored page', async () => {
      await openPagesList();

      expect(pageItems()).toHaveLength(2);
      expect(document.getElementById('no-pages')).toBeNull();
    });

    it('shows the empty state when the background reports no pages', async () => {
      respondToBackground(() => ({ success: true, pages: [] }));
      await openPagesList();

      expect(pageItems()).toHaveLength(0);
      expect(document.getElementById('no-pages').style.display).toBe('block');
    });

    it('falls back to the empty state when the background fails', async () => {
      respondToBackground(() => ({ success: false, error: 'storage unavailable' }));
      await openPagesList();

      expect(pageItems()).toHaveLength(0);
      expect(document.getElementById('no-pages').style.display).toBe('block');
    });

    it('shows the page title, url and highlight count', async () => {
      await openPagesList();
      const item = itemFor(NEWER.url);

      expect(item.querySelector('.page-title').textContent).toBe('Newer notes');
      expect(item.querySelector('.page-url').textContent).toBe(NEWER.url);
      expect(item.querySelector('.page-info').textContent).toContain('1');
    });

    it('falls back to host and path when a page has no title', async () => {
      respondToBackground(() => ({
        success: true,
        pages: [{ ...NEWER, title: '' }],
      }));
      await openPagesList();

      expect(document.querySelector('.page-title').textContent).toBe('example.com/newer');
    });

    it('reloads when the background asks the list to refresh', async () => {
      await openPagesList();
      const listener = chrome.runtime.onMessage.addListener.mock.calls.at(-1)[0];

      respondToBackground(() => ({ success: true, pages: [NEWER] }));
      listener({ action: 'refreshPagesList' });
      await flush();

      expect(renderedUrls()).toEqual([NEWER.url]);
    });
  });

  // ===================================================================
  // Sorting
  // ===================================================================

  describe('sorting', () => {
    it('lists the most recently updated page first', async () => {
      await openPagesList();

      expect(renderedUrls()).toEqual([NEWER.url, OLDER.url]);
    });

    it('reverses the order when the sort button is pressed', async () => {
      await openPagesList();
      document.getElementById('sort-btn').click();

      expect(renderedUrls()).toEqual([OLDER.url, NEWER.url]);
    });

    it('returns to newest-first on a second press', async () => {
      await openPagesList();
      const sortBtn = document.getElementById('sort-btn');
      sortBtn.click();
      sortBtn.click();

      expect(renderedUrls()).toEqual([NEWER.url, OLDER.url]);
    });
  });

  // ===================================================================
  // Search
  // ===================================================================

  describe('search', () => {
    it('keeps only pages whose title matches', async () => {
      await openPagesList();
      typeSearch('older');

      expect(renderedUrls()).toEqual([OLDER.url]);
    });

    it('matches on highlight text as well as title', async () => {
      await openPagesList();
      typeSearch('quotable');

      expect(renderedUrls()).toEqual([NEWER.url]);
    });

    it('marks the matching run inside the title', async () => {
      await openPagesList();
      typeSearch('notes');

      const marks = [...document.querySelectorAll('.page-title mark.search-match')];
      expect(marks.map(mark => mark.textContent)).toEqual(['notes']);
    });

    it('expands matching pages so the matched highlight is visible', async () => {
      await openPagesList();
      typeSearch('quotable');

      const item = itemFor(NEWER.url);
      expect(isExpanded(item)).toBe(true);
      expect(highlightTextsIn(item)).toEqual(['a quotable line']);
    });

    it('restores the full list when the term is cleared', async () => {
      await openPagesList();
      typeSearch('older');
      typeSearch('');

      expect(renderedUrls()).toEqual([NEWER.url, OLDER.url]);
    });

    it('clears the term on Escape', async () => {
      await openPagesList();
      const input = typeSearch('older');

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(input.value).toBe('');
      expect(renderedUrls()).toEqual([NEWER.url, OLDER.url]);
    });
  });

  // ===================================================================
  // Details
  // ===================================================================

  describe('page details', () => {
    it('starts collapsed and opens on the details button', async () => {
      await openPagesList();
      const item = itemFor(OLDER.url);

      expect(isExpanded(item)).toBe(false);
      item.querySelector('.btn-details').click();

      expect(isExpanded(item)).toBe(true);
    });

    it('orders highlights by their position on the page', async () => {
      await openPagesList();
      const item = itemFor(OLDER.url);
      item.querySelector('.btn-details').click();

      expect(highlightTextsIn(item)).toEqual(['first sentence', 'second sentence']);
    });

    it('says so when an entry has no highlights left', async () => {
      respondToBackground(() => ({
        success: true,
        pages: [{ ...NEWER, highlights: [] }],
      }));
      await openPagesList();

      document.querySelector('.btn-details').click();

      expect(highlightTextsIn(pageItems()[0])).toEqual(['noHighlights']);
    });

    it('collapses again on a second press', async () => {
      await openPagesList();
      const item = itemFor(OLDER.url);
      const details = item.querySelector('.btn-details');

      details.click();
      details.click();

      expect(isExpanded(item)).toBe(false);
    });

    it('expands every page at once, then collapses them', async () => {
      await openPagesList();
      const expandAll = document.getElementById('expand-all-btn');

      expandAll.click();
      expect(pageItems().every(isExpanded)).toBe(true);
      expect(expandAll.getAttribute('aria-pressed')).toBe('true');

      expandAll.click();
      expect(pageItems().some(isExpanded)).toBe(false);
      expect(expandAll.getAttribute('aria-pressed')).toBe('false');
    });

    it('disables expand-all when there is nothing to expand', async () => {
      respondToBackground(() => ({ success: true, pages: [] }));
      await openPagesList();

      expect(document.getElementById('expand-all-btn').disabled).toBe(true);
    });
  });

  // ===================================================================
  // Opening and deleting
  // ===================================================================

  describe('page actions', () => {
    it('opens the page in a new tab', async () => {
      await openPagesList();
      itemFor(NEWER.url).querySelector('.btn-view').click();

      expect(chrome.tabs.create).toHaveBeenCalledWith({ url: NEWER.url });
    });

    it('clears one page after the confirmation is accepted', async () => {
      await openPagesList();
      itemFor(OLDER.url).querySelector('.btn-delete').click();
      await confirmModal(true);

      expect(backgroundMessages('clearAllHighlights')).toHaveLength(1);
      expect(backgroundMessages('clearAllHighlights')[0][0]).toMatchObject({ url: OLDER.url });
    });

    it('leaves the page alone when the confirmation is cancelled', async () => {
      await openPagesList();
      itemFor(OLDER.url).querySelector('.btn-delete').click();
      await confirmModal(false);

      expect(backgroundMessages('clearAllHighlights')).toHaveLength(0);
    });

    it('empties the list once every page is deleted', async () => {
      await openPagesList();
      document.getElementById('delete-all-btn').click();
      await confirmModal(true);

      expect(backgroundMessages('deleteAllHighlightedPages')).toHaveLength(1);
      expect(pageItems()).toHaveLength(0);
      expect(document.getElementById('no-pages').style.display).toBe('block');
    });

    it('deletes nothing when the delete-all confirmation is cancelled', async () => {
      await openPagesList();
      document.getElementById('delete-all-btn').click();
      await confirmModal(false);

      expect(backgroundMessages('deleteAllHighlightedPages')).toHaveLength(0);
      expect(pageItems()).toHaveLength(2);
    });

    it('reloads the list when deleting everything fails', async () => {
      await openPagesList();
      respondToBackground(message => (
        message.action === 'deleteAllHighlightedPages'
          ? { success: false }
          : { success: true, pages: [NEWER] }
      ));

      document.getElementById('delete-all-btn').click();
      await confirmModal(true);

      expect(renderedUrls()).toEqual([NEWER.url]);
    });

    it('drops the search term when the list is refreshed', async () => {
      await openPagesList();
      typeSearch('older');
      expect(renderedUrls()).toEqual([OLDER.url]);

      document.getElementById('refresh-btn').click();
      await flush();

      expect(document.getElementById('search-input').value).toBe('');
      expect(renderedUrls()).toEqual([NEWER.url, OLDER.url]);
    });
  });

  // ===================================================================
  // Favicons
  // ===================================================================

  describe('favicons', () => {
    async function faviconFor(url) {
      respondToBackground(() => ({ success: true, pages: [{ ...NEWER, url }] }));
      await openPagesList();
      return document.querySelector('.page-favicon');
    }

    it('asks the favicon service for a web page, by host only', async () => {
      const favicon = await faviconFor('https://example.com/a/deep/path?q=secret');

      expect(favicon.src).toContain('https://www.google.com/s2/favicons');
      expect(favicon.src).toContain(encodeURIComponent('example.com'));
      expect(favicon.src).not.toContain('secret');
    });

    it('uses a local icon for a file url, with no outbound request', async () => {
      const favicon = await faviconFor('file:///home/reader/notes.html');

      expect(favicon.src.startsWith('data:image/svg+xml')).toBe(true);
    });

    it('falls back to a generic icon when the url will not parse', async () => {
      const favicon = await faviconFor('not-a-url');

      expect(favicon.src.startsWith('data:image/svg+xml')).toBe(true);
    });

    it('swaps in the fallback when the remote icon fails to load', async () => {
      const favicon = await faviconFor('https://example.com/article');
      const remoteSrc = favicon.src;

      favicon.dispatchEvent(new Event('error'));

      expect(favicon.src).not.toBe(remoteSrc);
      expect(favicon.src.startsWith('data:image/svg+xml')).toBe(true);
    });
  });

  // ===================================================================
  // Import and export
  // ===================================================================

  describe('import', () => {
    // The input's `files` is read-only, so the test puts the picked file there
    // the way the file dialog would before announcing the change.
    async function importFile(contents) {
      const input = document.getElementById('import-file');
      const file = new File([contents], 'highlights.json', { type: 'application/json' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });

      input.dispatchEvent(new Event('change'));
      await settled();
    }

    function importJson(payload) {
      return importFile(JSON.stringify(payload));
    }

    // Every import path ends either at a modal - a warning, or the overwrite
    // question - or at the write itself.
    function settled() {
      return waitFor(
        () => alertText() !== null || chrome.storage.local.set.mock.calls.length > 0,
        'the import to reach a modal or a write',
      );
    }

    function importablePage(url) {
      return {
        url,
        title: 'Imported',
        lastUpdated: '2026-05-01T00:00:00.000Z',
        highlights: [
          {
            groupId: 'i1',
            color: '#ffd54f',
            text: 'imported text',
            spans: [{ text: 'imported text', position: 1, spanId: 's1' }],
          },
        ],
      };
    }

    it('writes the imported pages to storage and reloads', async () => {
      await openPagesList();
      await importJson({ pages: [importablePage('https://example.com/imported')] });

      expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
      const [written] = chrome.storage.local.set.mock.calls[0];
      expect(Object.keys(written)).toEqual([
        'https://example.com/imported',
        'https://example.com/imported_meta',
      ]);
      expect(alertText()).toBe('importSuccess');
    });

    it('rejects a file that is not an export at all', async () => {
      await openPagesList();
      await importJson({ notPages: true });

      expect(alertText()).toBe('importInvalidFormat');
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('skips pages whose url is not safe to open', async () => {
      await openPagesList();
      await importJson({
        pages: [
          importablePage('javascript:alert(1)'),
          importablePage('https://example.com/safe'),
        ],
      });

      expect(alertText()).toBe('importUnsafeUrlSkipped');
      await dismissAlert();
      await waitFor(() => chrome.storage.local.set.mock.calls.length > 0, 'the safe page to be written');

      const [written] = chrome.storage.local.set.mock.calls[0];
      expect(Object.keys(written)).toEqual([
        'https://example.com/safe',
        'https://example.com/safe_meta',
      ]);
    });

    it('imports nothing when every url is unsafe', async () => {
      await openPagesList();
      await importJson({ pages: [importablePage('javascript:alert(1)')] });

      expect(alertText()).toBe('importUnsafeUrlSkipped');
      await dismissAlert();

      expect(alertText()).toBe('importAllUnsafeUrl');
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('replaces existing highlights only after the overwrite is confirmed', async () => {
      await openPagesList();
      await importJson({ pages: [importablePage(OLDER.url)] });
      await confirmModal(true);

      const [written] = chrome.storage.local.set.mock.calls[0];
      expect(written[OLDER.url]).toHaveLength(1);
    });

    it('writes nothing when the overwrite is declined', async () => {
      await openPagesList();
      await importJson({ pages: [importablePage(OLDER.url)] });
      await confirmModal(false);

      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('reports a file that is not valid json', async () => {
      await openPagesList();
      await importFile('{ not json');

      expect(alertText()).toBe('importInvalidFormat');
    });
  });

  describe('export', () => {
    let objectUrls;
    let savedUrlMethods;

    // jsdom implements neither of these, so the download path needs them stood up.
    beforeEach(() => {
      objectUrls = [];
      savedUrlMethods = {
        create: URL.createObjectURL,
        revoke: URL.revokeObjectURL,
      };
      URL.createObjectURL = jest.fn(blob => {
        objectUrls.push(blob);
        return 'blob:highlights';
      });
      URL.revokeObjectURL = jest.fn();
    });

    afterEach(() => {
      URL.createObjectURL = savedUrlMethods.create;
      URL.revokeObjectURL = savedUrlMethods.revoke;
      jest.restoreAllMocks();
    });

    it('offers the stored pages as a download', async () => {
      await openPagesList();
      const clicked = [];
      jest.spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(function () { clicked.push(this.download); });

      document.getElementById('export-all-btn').click();
      await flush();

      expect(objectUrls).toHaveLength(1);
      expect(clicked[0]).toMatch(/^all-highlights-\d+\.json$/);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:highlights');
    });

    it('says there is nothing to export when the list is empty', async () => {
      respondToBackground(() => ({ success: true, pages: [] }));
      await openPagesList();

      document.getElementById('export-all-btn').click();
      await flush();

      expect(alertText()).toBe('noHighlightsToExport');
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('closes the overflow menu it was launched from', async () => {
      await openPagesList();
      jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      document.getElementById('more-menu-btn').click();
      document.getElementById('export-all-btn').click();
      await flush();

      expect(document.getElementById('more-menu').hidden).toBe(true);
    });
  });

  // ===================================================================
  // Overflow menu
  // ===================================================================

  describe('the more menu', () => {
    it('opens on its button and closes on Escape', async () => {
      await openPagesList();
      const button = document.getElementById('more-menu-btn');
      const menu = document.getElementById('more-menu');

      button.click();
      expect(menu.hidden).toBe(false);
      expect(button.getAttribute('aria-expanded')).toBe('true');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(menu.hidden).toBe(true);
      expect(button.getAttribute('aria-expanded')).toBe('false');
    });

    it('closes when a click lands outside it', async () => {
      await openPagesList();
      const button = document.getElementById('more-menu-btn');
      const menu = document.getElementById('more-menu');

      button.click();
      expect(menu.hidden).toBe(false);

      document.body.click();

      expect(menu.hidden).toBe(true);
    });
  });
});
