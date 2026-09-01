import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import {
  advance,
  loadPageScript,
  readPageBody,
  respondToTab,
  stubPageEnvironment,
} from './helpers/extension-page.js';

const POPUP_BODY = readPageBody(new URL('../popup.html', import.meta.url));

const PAGE_URL = 'https://example.com/article';
const TAB = { id: 7, url: PAGE_URL };

// Longer than the popup's own PENDING_RESTORE_POLL_LIMIT_MS, so a test can run
// past the point where it gives up polling.
const PAST_POLL_LIMIT_MS = 20000;

describe('popup', () => {
  let openPopup;
  let closePopup;

  beforeAll(async () => {
    ({ close: closePopup } = stubPageEnvironment());
    openPopup = await loadPageScript(() => import('../popup.js'));
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    document.body.innerHTML = POPUP_BODY;

    chrome.i18n.getMessage.mockImplementation(key => key);
    chrome.tabs.query.mockResolvedValue([TAB]);
    chrome.runtime.getURL.mockImplementation(path => `chrome-extension://test/${path}`);
    chrome.runtime.sendMessage.mockResolvedValue({ success: true });
    setStoredHighlights([
      { groupId: 'g1', text: 'first highlight', color: '#ffd54f', spans: [{ position: 1 }] },
      { groupId: 'g2', text: 'second highlight', color: '#80cbc4', spans: [{ position: 2 }] },
    ]);
    respondToTab(() => ({ success: true, groupIds: ['g1', 'g2'], pendingRestoreMs: 0 }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function setStoredHighlights(highlights) {
    chrome.storage.local.get.mockResolvedValue({ [PAGE_URL]: highlights });
  }

  function items() {
    return [...document.querySelectorAll('.highlight-item')];
  }

  function missingGroupIds() {
    return items()
      .filter(item => item.classList.contains('is-missing'))
      .map(item => item.dataset.groupId);
  }

  function tabMessages(action) {
    return chrome.tabs.sendMessage.mock.calls.filter(([, message]) => message.action === action);
  }

  describe('marking highlights the page could not restore', () => {
    it('marks the entries the page did not report as restored', async () => {
      respondToTab(() => ({ success: true, groupIds: ['g1'], pendingRestoreMs: 0 }));

      await openPopup();
      await advance();

      expect(missingGroupIds()).toEqual(['g2']);
      expect(document.querySelector('.is-missing .retry-btn')).not.toBeNull();
    });

    it('leaves every entry alone while the page still reports a pending restore', async () => {
      respondToTab(() => ({ success: true, groupIds: [], pendingRestoreMs: 300 }));

      await openPopup();
      await advance(1000);

      expect(missingGroupIds()).toEqual([]);
    });

    it('asks again until the page reports the restore is done', async () => {
      let pendingRestoreMs = 300;
      respondToTab(() => ({ success: true, groupIds: ['g1'], pendingRestoreMs }));

      await openPopup();
      await advance(600);
      expect(missingGroupIds()).toEqual([]);

      pendingRestoreMs = 0;
      await advance(600);

      expect(missingGroupIds()).toEqual(['g2']);
      expect(tabMessages('getRestoredGroupIds').length).toBeGreaterThan(1);
    });

    it('stops asking and marks nothing when the restore stays pending past the limit', async () => {
      respondToTab(() => ({ success: true, groupIds: [], pendingRestoreMs: 300 }));

      await openPopup();
      await advance(PAST_POLL_LIMIT_MS);
      const asked = tabMessages('getRestoredGroupIds').length;

      // Still pending is "not yet", never "not there" - an entry that is really
      // gone keeps looking normal rather than a working one being made dead.
      expect(missingGroupIds()).toEqual([]);

      await advance(PAST_POLL_LIMIT_MS);
      expect(tabMessages('getRestoredGroupIds')).toHaveLength(asked);
    });

    it('leaves every entry alone when no content script answers', async () => {
      chrome.tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));

      await openPopup();
      await advance();

      expect(missingGroupIds()).toEqual([]);
    });

    it('leaves every entry alone when the page answers without success', async () => {
      respondToTab(() => ({ success: false }));

      await openPopup();
      await advance();

      expect(missingGroupIds()).toEqual([]);
    });

    it('does not mark entries that were replaced while the query was in flight', async () => {
      respondToTab(() => ({ success: true, groupIds: [], pendingRestoreMs: 300 }));

      await openPopup();
      const stale = items();
      expect(stale).toHaveLength(2);

      // The list is re-rendered - a delete, say - before the poll comes back.
      document.getElementById('highlights-container').replaceChildren();
      respondToTab(() => ({ success: true, groupIds: [], pendingRestoreMs: 0 }));
      await advance(600);

      expect(stale.some(item => item.classList.contains('is-missing'))).toBe(false);
    });

    it('sends every tab message in the promise form', async () => {
      respondToTab(() => ({ success: true, groupIds: [], pendingRestoreMs: 0 }));

      await openPopup();
      await advance();

      expect(chrome.tabs.sendMessage).toHaveBeenCalled();
      for (const args of chrome.tabs.sendMessage.mock.calls) {
        // A callback in the third argument is never called on Firefox, where it
        // lands in the options slot. Chromium-only E2E cannot catch that.
        expect(args).toHaveLength(2);
      }
    });
  });

  describe('finding a missing highlight again', () => {
    beforeEach(async () => {
      respondToTab(message => {
        if (message.action === 'getRestoredGroupIds') {
          return { success: true, groupIds: ['g1'], pendingRestoreMs: 0 };
        }
        return { success: true };
      });

      await openPopup();
      await advance();
    });

    function missingItem() {
      return document.querySelector('.is-missing');
    }

    it('clears the mark and jumps to the highlight when the retry lands', async () => {
      respondToTab(message => {
        if (message.action === 'retryRestoreHighlight') return { restored: true };
        return { success: true };
      });

      missingItem().querySelector('.retry-btn').click();
      await advance();

      const item = items().find(el => el.dataset.groupId === 'g2');
      expect(item.classList.contains('is-missing')).toBe(false);
      expect(item.querySelector('.missing-note')).toBeNull();
      expect(item.getAttribute('role')).toBe('button');
      expect(tabMessages('scrollToHighlight')[0][1].groupId).toBe('g2');
      expect(closePopup).toHaveBeenCalled();
    });

    it('explains the failure in place and lets the reader try again', async () => {
      respondToTab(message => {
        if (message.action === 'retryRestoreHighlight') return { restored: false };
        return { success: true };
      });

      const retryBtn = missingItem().querySelector('.retry-btn');
      retryBtn.click();
      await advance();

      expect(missingItem()).not.toBeNull();
      expect(retryBtn.disabled).toBe(false);
      expect(missingItem().querySelector('.missing-note').textContent)
        .toContain('retryFindHighlightFailed');
      expect(tabMessages('scrollToHighlight')).toHaveLength(0);
    });

    it('does not jump when a marked entry is clicked', async () => {
      missingItem().click();
      await advance();

      expect(tabMessages('scrollToHighlight')).toHaveLength(0);
    });
  });

  describe('opening the pages list', () => {
    const LIST_URL = 'chrome-extension://test/pages-list.html';

    it('focuses the window that already has the list open', async () => {
      chrome.windows.getAll.mockResolvedValue([
        { id: 3, tabs: [{ id: 21, url: 'https://example.com/' }] },
        { id: 4, tabs: [{ id: 22, url: `${LIST_URL}#anchor` }] },
      ]);

      await openPopup();
      document.getElementById('view-all-pages').click();
      await advance();

      expect(chrome.windows.update).toHaveBeenCalledWith(4, { focused: true });
      expect(chrome.tabs.update).toHaveBeenCalledWith(22, { active: true });
      expect(tabMessages('refreshPagesList')[0][0]).toBe(22);
      expect(chrome.windows.create).not.toHaveBeenCalled();
    });

    it('opens a popup window when the list is not open anywhere', async () => {
      chrome.windows.getAll.mockResolvedValue([{ id: 3, tabs: [] }]);

      await openPopup();
      document.getElementById('view-all-pages').click();
      await advance();

      expect(chrome.windows.create).toHaveBeenCalledWith(
        expect.objectContaining({ url: LIST_URL, type: 'popup' })
      );
    });

    it('falls back to tabs where there is no windows API', async () => {
      const { windows } = chrome;
      delete chrome.windows;
      chrome.tabs.query.mockResolvedValue([TAB]);

      try {
        await openPopup();
        document.getElementById('view-all-pages').click();
        await advance();

        expect(chrome.tabs.create).toHaveBeenCalledWith({ url: LIST_URL });
        expect(closePopup).toHaveBeenCalled();
      } finally {
        chrome.windows = windows;
      }
    });
  });

  describe('the empty list', () => {
    it('shows the empty note and disables clear-all without asking the page anything', async () => {
      setStoredHighlights([]);

      await openPopup();
      await advance();

      expect(document.getElementById('no-highlights').style.display).toBe('block');
      expect(document.getElementById('clear-all').disabled).toBe(true);
      expect(tabMessages('getRestoredGroupIds')).toHaveLength(0);
    });

    // The note is re-appended to an emptied container on every render, and the
    // i18n pass writes textContent over any element carrying a data-i18n key.
    // Either one would take the tips with it if the markup were nested another way.
    it('keeps the usage tips and the guide link inside the note', async () => {
      setStoredHighlights([]);

      await openPopup();
      await advance();

      const note = document.getElementById('no-highlights');
      expect(note.parentElement.id).toBe('highlights-container');
      expect(note.querySelector('.empty-title').textContent).toBe('noHighlights');
      expect([...note.querySelectorAll('.empty-tips li')].map(li => li.textContent)).toEqual([
        'popupTipSelect',
        'popupTipPick',
        'popupTipManage',
      ]);
      expect(note.querySelector('.empty-guide-link').getAttribute('href')).toBe(
        'onboarding.html'
      );
    });
  });
});
