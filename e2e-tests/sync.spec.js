const path = require('path');
const { pathToFileURL } = require('url');
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

async function waitForSyncReady(background) {
  await background.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const startTime = Date.now();
      const check = async () => {
        const result = await chrome.storage.local.get('syncMigrationDone');
        if (result.syncMigrationDone) {
          resolve();
        } else if (Date.now() - startTime > 10000) {
          reject(new Error('Timeout waiting for syncMigrationDone'));
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  });
}

function testFileUrl(fileName) {
  return pathToFileURL(path.join(__dirname, fileName)).href;
}

test.describe('Sync scenarios', () => {
  test('sync key removal arrives before tombstone meta update -> eventually treated as user deletion', async ({ background }) => {
    const url = testFileUrl('test-page.html');
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

  test('M-2: Propagation of new highlights from sync to local and UI', async ({ page, background }) => {
    const url = testFileUrl('test-page.html');
    await page.goto(url);
    const syncKey = urlToSyncKey(url);
    const highlights = createHighlight('g_remote_prop', 'sample paragraph');

    // Simulate another device adding a highlight
    await background.evaluate(async ({ url, syncKey, highlights }) => {
      const now = new Date().toISOString();

      // Update sync_meta first so when the highlight key change arrives, the meta is already consistent if needed
      const result = await chrome.storage.sync.get('sync_meta');
      const meta = result.sync_meta || { pages: [], totalSize: 0, deletedUrls: {} };
      meta.pages.push({ syncKey, url, lastUpdated: now, size: 200 });
      meta.totalSize += 200;
      await chrome.storage.sync.set({ sync_meta: meta });

      await chrome.storage.sync.set({
        [syncKey]: {
          url,
          title: 'test-page',
          lastUpdated: now,
          highlights,
          deletedGroupIds: {}
        }
      });
    }, { url, syncKey, highlights });

    // Verify UI update - wait for the propagation
    const highlightedSpan = page.locator('span.text-highlighter-extension:has-text("sample paragraph")');
    await expect(highlightedSpan).toBeVisible({ timeout: 10000 });

    // Verify local storage update
    const local = await background.evaluate(async (url) => {
      return await chrome.storage.local.get(url);
    }, url);
    expect(local[url]).toHaveLength(1);
    expect(local[url][0].text).toBe('sample paragraph');
  });

  test('M-11: Live update on deletion from sync', async ({ page, background }) => {
    const url = testFileUrl('test-page.html');
    const syncKey = urlToSyncKey(url);
    const highlights = createHighlight('g_to_be_deleted', 'Another paragraph');

    // Setup: already has a highlight in storage BEFORE navigating
    await background.evaluate(async ({ url, syncKey, highlights }) => {
      const now = new Date().toISOString();
      await chrome.storage.local.set({
        [url]: highlights,
        [`${url}_meta`]: { title: 'test-page', lastUpdated: now, deletedGroupIds: {} }
      });
      await chrome.storage.sync.set({
        [syncKey]: {
          url,
          title: 'test-page',
          lastUpdated: now,
          highlights,
          deletedGroupIds: {}
        },
        sync_meta: {
          pages: [{ syncKey, url, lastUpdated: now, size: 200 }],
          totalSize: 200,
          deletedUrls: {}
        }
      });
    }, { url, syncKey, highlights });

    await page.goto(url);

    // Verify it's there first
    const highlightedSpan = page.locator('span.text-highlighter-extension:has-text("Another paragraph")');
    await expect(highlightedSpan).toBeVisible();

    // Simulate another device deleting the page highlights
    await background.evaluate(async ({ url, syncKey }) => {
      const now = Date.now();
      const result = await chrome.storage.sync.get('sync_meta');
      const meta = result.sync_meta || { pages: [], totalSize: 0, deletedUrls: {} };
      meta.deletedUrls = meta.deletedUrls || {};
      meta.deletedUrls[url] = now;
      await chrome.storage.sync.set({ sync_meta: meta });
      await chrome.storage.sync.remove(syncKey);
    }, { url, syncKey });

    // Verify UI update (disappears)
    await expect(highlightedSpan).toHaveCount(0, { timeout: 10000 });

    // Verify local storage update
    const local = await background.evaluate(async (url) => {
      return await chrome.storage.local.get(url);
    }, url);
    expect(local[url]).toBeUndefined();
  });

  test('M-6: Merge of highlights (Addition merge)', async ({ page, background }) => {
    const url = testFileUrl('test-page.html');
    const syncKey = urlToSyncKey(url);
    const localHighlights = createHighlight('g_local', 'Welcome to the Test Page');
    const remoteHighlights = createHighlight('g_remote', 'sample paragraph');

    // 1. Setup local highlights
    await background.evaluate(async ({ url, localHighlights }) => {
      await chrome.storage.local.set({
        [url]: localHighlights,
        [`${url}_meta`]: { title: 'test-page', lastUpdated: new Date().toISOString(), deletedGroupIds: {} }
      });
    }, { url, localHighlights });

    await page.goto(url);
    await expect(page.locator('span.text-highlighter-extension:has-text("Welcome to the Test Page")')).toBeVisible();

    // 2. Simulate another device adding a different highlight
    await background.evaluate(async ({ url, syncKey, remoteHighlights }) => {
      const now = new Date().toISOString();
      await chrome.storage.sync.set({
        [syncKey]: {
          url,
          title: 'test-page',
          lastUpdated: now,
          highlights: remoteHighlights,
          deletedGroupIds: {}
        }
      });
    }, { url, syncKey, remoteHighlights });

    // 3. Both should be visible (Union)
    await expect(page.locator('span.text-highlighter-extension:has-text("Welcome to the Test Page")')).toBeVisible();
    await expect(page.locator('span.text-highlighter-extension:has-text("sample paragraph")')).toBeVisible({ timeout: 10000 });

    // 4. Local storage should have both
    const local = await background.evaluate(async (url) => {
      return await chrome.storage.local.get(url);
    }, url);
    expect(local[url]).toHaveLength(2);
  });

  test('M-7: Conflict resolution (Last-Write-Wins)', async ({ page, background }) => {
    const url = testFileUrl('test-page.html');
    const syncKey = urlToSyncKey(url);
    const groupId = 'g_conflict';
    const text = 'Welcome to the Test Page';

    const localHighlight = {
      groupId,
      color: '#FF0000', // Red
      text,
      updatedAt: 1000,
      spans: [{ spanId: `${groupId}_0`, text, position: 10 }]
    };

    const remoteHighlight = {
      groupId,
      color: '#0000FF', // Blue
      text,
      updatedAt: 2000, // Newer
      spans: [{ spanId: `${groupId}_0`, text, position: 10 }]
    };

    // 1. Setup local red highlight
    await background.evaluate(async ({ url, localHighlight }) => {
      await chrome.storage.local.set({
        [url]: [localHighlight],
        [`${url}_meta`]: { title: 'test-page', lastUpdated: new Date().toISOString(), deletedGroupIds: {} }
      });
    }, { url, localHighlight });

    await page.goto(url);
    const highlightedSpan = page.locator('span.text-highlighter-extension:has-text("Welcome to the Test Page")');
    await expect(highlightedSpan).toHaveCSS('background-color', 'rgb(255, 0, 0)');

    // 2. Simulate another device updating the SAME highlight with a newer timestamp and different color
    await background.evaluate(async ({ url, syncKey, remoteHighlight }) => {
      const now = new Date().toISOString();
      await chrome.storage.sync.set({
        [syncKey]: {
          url,
          title: 'test-page',
          lastUpdated: now,
          highlights: [remoteHighlight],
          deletedGroupIds: {}
        }
      });
    }, { url, syncKey, remoteHighlight });

    // 3. It should update to Blue (LWW)
    await expect(highlightedSpan).toHaveCSS('background-color', 'rgb(0, 0, 255)', { timeout: 10000 });

    // 4. Local storage should have blue
    const local = await background.evaluate(async (url) => {
      return await chrome.storage.local.get(url);
    }, url);
    expect(local[url][0].color).toBe('#0000FF');
  });

  test('M-8: Settings propagation (Minimap visibility)', async ({ page, background }) => {
    const url = testFileUrl('test-page.html');
    const highlights = createHighlight('g_minimap', 'sample paragraph');
    await background.evaluate(async ({ url, highlights }) => {
      await chrome.storage.local.set({ [url]: highlights });
    }, { url, highlights });

    await page.goto(url);
    await waitForSyncReady(background);

    // Initially minimap should be visible (default, and we have highlights)
    const minimap = page.locator('.text-highlighter-minimap');
    await expect(minimap).toBeVisible();

    // Simulate another device disabling minimap
    await background.evaluate(async () => {
      await chrome.storage.sync.set({
        settings: {
          minimapVisible: false,
          selectionControlsVisible: true,
          customColors: []
        }
      });
    });

    // It should be hidden
    await expect(minimap).toBeHidden({ timeout: 10000 });
  });

  test('M-9: Custom colors propagation', async ({ page, background }) => {
    await page.goto(testFileUrl('test-page.html'));
    await waitForSyncReady(background);

    // Simulate another device adding a custom color
    const customColor = { id: 'custom_123', nameKey: 'customColor', colorNumber: 1, color: '#123456' };
    await background.evaluate(async (customColor) => {
      await chrome.storage.sync.set({
        settings: {
          minimapVisible: true,
          selectionControlsVisible: true,
          customColors: [customColor]
        }
      });
    }, customColor);

    // Verify local storage update
    await expect.poll(async () => {
      const result = await background.evaluate(async () => {
        return await chrome.storage.local.get('customColors');
      });
      return result.customColors;
    }, { timeout: 10000 }).toContainEqual(customColor);
  });

  test('sync key removal without tombstone -> treated as eviction and local data is kept', async ({ background }) => {
    const url = testFileUrl('test-page2.html');
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
    const url1 = testFileUrl('test-page.html');
    const url2 = testFileUrl('test-page3.html');
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
