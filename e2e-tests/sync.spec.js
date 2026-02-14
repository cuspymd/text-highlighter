const path = require('path');
import { test, expect } from './fixtures';

function urlToSyncKey(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const ch = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return `hl_${Math.abs(hash).toString(36)}`;
}

function createHighlight(groupId, text) {
  return [{
    groupId,
    color: '#FFFF00',
    text,
    updatedAt: Date.now(),
    spans: [{ spanId: `${groupId}_0`, text, position: 10 }]
  }];
}

async function waitInBackground(background, ms) {
  await background.evaluate(async (timeoutMs) => {
    await new Promise(resolve => setTimeout(resolve, timeoutMs));
  }, ms);
}

test.describe('Sync scenarios', () => {
  test('sync key removal arrives before tombstone meta update -> eventually treated as user deletion', async ({ background }) => {
    const url = `file:///${path.join(__dirname, 'test-page.html')}`;
    const syncKey = urlToSyncKey(url);
    const highlights = createHighlight('g_remove_then_meta', 'remove-then-meta');

    await background.evaluate(async ({ url, syncKey, highlights }) => {
      await chrome.storage.local.clear();
      await chrome.storage.sync.clear();

      await chrome.storage.local.set({
        [url]: highlights,
        [`${url}_meta`]: {
          title: 'test-page',
          lastUpdated: new Date().toISOString(),
          deletedGroupIds: {}
        }
      });

      await chrome.storage.sync.set({
        [syncKey]: {
          url,
          title: 'test-page',
          lastUpdated: new Date().toISOString(),
          highlights,
          deletedGroupIds: {}
        },
        sync_meta: {
          pages: [{ syncKey, url, lastUpdated: new Date().toISOString(), size: 200 }],
          totalSize: 200,
          deletedUrls: {}
        }
      });
    }, { url, syncKey, highlights });

    // Simulate out-of-order propagation: page key removal first.
    await background.evaluate(async ({ syncKey }) => {
      await chrome.storage.sync.remove(syncKey);
    }, { syncKey });

    // Tombstone update arrives later.
    await waitInBackground(background, 400);
    await background.evaluate(async ({ url }) => {
      const now = Date.now();
      const result = await chrome.storage.sync.get('sync_meta');
      const meta = result.sync_meta || { pages: [], totalSize: 0, deletedUrls: {} };
      meta.deletedUrls = meta.deletedUrls || {};
      meta.deletedUrls[url] = now;
      await chrome.storage.sync.set({ sync_meta: meta });
    }, { url });

    // Wait longer than the retry window in background.js.
    await waitInBackground(background, 2600);

    const local = await background.evaluate(async ({ url }) => {
      return await chrome.storage.local.get([url, `${url}_meta`]);
    }, { url });

    expect(local[url]).toBeUndefined();
    expect(local[`${url}_meta`]).toBeUndefined();
  });

  test('sync key removal without tombstone -> treated as eviction and local data is kept', async ({ background }) => {
    const url = `file:///${path.join(__dirname, 'test-page2.html')}`;
    const syncKey = urlToSyncKey(url);
    const highlights = createHighlight('g_eviction', 'eviction-case');

    await background.evaluate(async ({ url, syncKey, highlights }) => {
      await chrome.storage.local.clear();
      await chrome.storage.sync.clear();

      await chrome.storage.local.set({
        [url]: highlights,
        [`${url}_meta`]: {
          title: 'test-page2',
          lastUpdated: new Date().toISOString(),
          deletedGroupIds: {}
        }
      });

      await chrome.storage.sync.set({
        [syncKey]: {
          url,
          title: 'test-page2',
          lastUpdated: new Date().toISOString(),
          highlights,
          deletedGroupIds: {}
        },
        sync_meta: {
          pages: [{ syncKey, url, lastUpdated: new Date().toISOString(), size: 200 }],
          totalSize: 200,
          deletedUrls: {}
        }
      });
    }, { url, syncKey, highlights });

    await background.evaluate(async ({ syncKey }) => {
      await chrome.storage.sync.remove(syncKey);
    }, { syncKey });

    await waitInBackground(background, 2600);

    const local = await background.evaluate(async ({ url }) => {
      return await chrome.storage.local.get([url, `${url}_meta`]);
    }, { url });

    expect(Array.isArray(local[url])).toBeTruthy();
    expect(local[url].length).toBe(1);
    expect(local[`${url}_meta`]).toBeTruthy();
  });

  test('deleteAllHighlightedPages keeps deletion tombstones in sync_meta', async ({ background, context, extensionId }) => {
    const url1 = `file:///${path.join(__dirname, 'test-page.html')}`;
    const url2 = `file:///${path.join(__dirname, 'test-page3.html')}`;
    const syncKey1 = urlToSyncKey(url1);
    const syncKey2 = urlToSyncKey(url2);
    const highlights1 = createHighlight('g_all_1', 'all-1');
    const highlights2 = createHighlight('g_all_2', 'all-2');

    await background.evaluate(async ({ url1, url2, syncKey1, syncKey2, highlights1, highlights2 }) => {
      await chrome.storage.local.clear();
      await chrome.storage.sync.clear();

      await chrome.storage.local.set({
        [url1]: highlights1,
        [`${url1}_meta`]: { title: 'page1', lastUpdated: new Date().toISOString(), deletedGroupIds: {} },
        [url2]: highlights2,
        [`${url2}_meta`]: { title: 'page2', lastUpdated: new Date().toISOString(), deletedGroupIds: {} }
      });

      await chrome.storage.sync.set({
        [syncKey1]: { url: url1, title: 'page1', lastUpdated: new Date().toISOString(), highlights: highlights1, deletedGroupIds: {} },
        [syncKey2]: { url: url2, title: 'page2', lastUpdated: new Date().toISOString(), highlights: highlights2, deletedGroupIds: {} },
        sync_meta: {
          pages: [
            { syncKey: syncKey1, url: url1, lastUpdated: new Date().toISOString(), size: 200 },
            { syncKey: syncKey2, url: url2, lastUpdated: new Date().toISOString(), size: 200 }
          ],
          totalSize: 400,
          deletedUrls: {}
        }
      });
    }, { url1, url2, syncKey1, syncKey2, highlights1, highlights2 });

    const runtimePage = await context.newPage();
    await runtimePage.goto(`chrome-extension://${extensionId}/popup.html`);
    const response = await runtimePage.evaluate(async () => {
      return await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'deleteAllHighlightedPages' }, resolve);
      });
    });
    await runtimePage.close();

    expect(response.success).toBeTruthy();

    const [syncState, localState] = await Promise.all([
      background.evaluate(async () => await chrome.storage.sync.get(['sync_meta'])),
      background.evaluate(async ({ url1, url2 }) => await chrome.storage.local.get([url1, `${url1}_meta`, url2, `${url2}_meta`]), { url1, url2 })
    ]);

    const meta = syncState.sync_meta;
    expect(meta.pages).toHaveLength(0);
    expect(meta.totalSize).toBe(0);
    expect(meta.deletedUrls[url1]).toBeTruthy();
    expect(meta.deletedUrls[url2]).toBeTruthy();

    expect(localState[url1]).toBeUndefined();
    expect(localState[`${url1}_meta`]).toBeUndefined();
    expect(localState[url2]).toBeUndefined();
    expect(localState[`${url2}_meta`]).toBeUndefined();
  });
});
