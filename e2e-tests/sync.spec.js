import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { test, expect } from './fixtures';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  await expect.poll(async () => {
    return await background.evaluate(async () => {
      const result = await chrome.storage.local.get('bookmarkMigrationDone');
      return !!result.bookmarkMigrationDone;
    });
  }, {
    message: 'Wait for sync migration to complete',
    timeout: 10000,
  }).toBe(true);
}

async function installStorageSyncBookmarkBridge(background) {
  await background.evaluate(async () => {
    if (globalThis.__syncBridgeInstalled) return;

    const ROOT_FOLDER_TITLE = 'Text Highlighter Sync';

    const encodeUtf8 = (value) => {
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value);
      return Uint8Array.from(Buffer.from(value, 'utf-8'));
    };
    const decodeUtf8 = (bytes) => {
      if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
      return Buffer.from(bytes).toString('utf-8');
    };
    const encodeBase64 = (value) => {
      const bytes = encodeUtf8(value);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      return btoa(binary);
    };
    const decodeBase64 = (value) => {
      const binary = atob(value);
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      return decodeUtf8(bytes);
    };
    const toDataUrl = (payload) => `data:application/json;base64,${encodeBase64(JSON.stringify(payload))}`;
    const fromDataUrl = (url) => {
      if (!url || typeof url !== 'string') return null;
      const marker = 'base64,';
      const idx = url.indexOf(marker);
      if (idx < 0) return null;
      return JSON.parse(decodeBase64(url.slice(idx + marker.length)));
    };

    const getRootId = async () => {
      const results = await chrome.bookmarks.search({ title: ROOT_FOLDER_TITLE });
      const folder = results.find(node => !node.url && node.title === ROOT_FOLDER_TITLE);
      if (folder) return folder.id;
      const created = await chrome.bookmarks.create({ title: ROOT_FOLDER_TITLE });
      return created.id;
    };
    const findByTitle = async (title) => {
      const rootId = await getRootId();
      const children = await chrome.bookmarks.getChildren(rootId);
      return children.find(node => node.title === title);
    };
    const upsertByTitle = async (title, payload) => {
      const dataUrl = toDataUrl(payload);
      const existing = await findByTitle(title);
      if (existing) {
        await chrome.bookmarks.update(existing.id, { title, url: dataUrl });
      } else {
        const parentId = await getRootId();
        await chrome.bookmarks.create({ parentId, title, url: dataUrl });
      }
    };
    const removeByTitle = async (title) => {
      const existing = await findByTitle(title);
      if (existing) await chrome.bookmarks.remove(existing.id);
    };

    const broadcastByUrl = async (url, message) => {
      const tabs = await chrome.tabs.query({ url });
      for (const tab of tabs) {
        try { await chrome.tabs.sendMessage(tab.id, message); } catch {}
      }
    };

    const applySettingsPayload = async (settings) => {
      if (!settings) return;
      const toSet = {};
      if (settings.customColors !== undefined) toSet.customColors = settings.customColors;
      if (settings.minimapVisible !== undefined) toSet.minimapVisible = settings.minimapVisible;
      if (settings.selectionControlsVisible !== undefined) toSet.selectionControlsVisible = settings.selectionControlsVisible;
      if (Object.keys(toSet).length > 0) await chrome.storage.local.set(toSet);

      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        try {
          if (settings.customColors !== undefined) {
            await chrome.tabs.sendMessage(tab.id, { action: 'colorsUpdated', colors: settings.customColors || [] });
          }
          if (settings.minimapVisible !== undefined) {
            await chrome.tabs.sendMessage(tab.id, { action: 'setMinimapVisibility', visible: settings.minimapVisible });
          }
          if (settings.selectionControlsVisible !== undefined) {
            await chrome.tabs.sendMessage(tab.id, { action: 'setSelectionControlsVisibility', visible: settings.selectionControlsVisible });
          }
        } catch {}
      }
    };

    const applyHighlightPayload = async (payload) => {
      if (!payload || !payload.url) return;
      const url = payload.url;
      await chrome.storage.local.set({
        [url]: payload.highlights || [],
        [`${url}_meta`]: {
          title: payload.title || '',
          lastUpdated: payload.lastUpdated || '',
          deletedGroupIds: payload.deletedGroupIds || {},
        },
      });
      await broadcastByUrl(url, { action: 'refreshHighlights', highlights: payload.highlights || [] });
    };

    const bridgeGet = async (keys) => {
      if (keys == null) return {};
      const list = Array.isArray(keys) ? keys : [keys];
      const result = {};
      for (const key of list) {
        const node = await findByTitle(key);
        if (node && node.url) result[key] = fromDataUrl(node.url);
      }
      return result;
    };

    const bridgeSet = async (items) => {
      for (const [key, value] of Object.entries(items || {})) {
        await upsertByTitle(key, value);

        if (key === 'settings') {
          await applySettingsPayload(value);
        } else if (key === 'sync_meta') {
          const deleted = (value && value.deletedUrls) || {};
          for (const [url, deletedAt] of Object.entries(deleted)) {
            if (!deletedAt) continue;
            await chrome.storage.local.remove([url, `${url}_meta`]);
            await broadcastByUrl(url, { action: 'refreshHighlights', highlights: [] });
          }
        } else if (key.startsWith('hl_')) {
          await applyHighlightPayload(value);
        }
      }
    };

    const bridgeRemove = async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        const existing = await findByTitle(key);
        const payload = existing && existing.url ? fromDataUrl(existing.url) : null;
        await removeByTitle(key);

        if (key.startsWith('hl_') && payload && payload.url) {
          const meta = (await bridgeGet('sync_meta')).sync_meta || {};
          const deletedUrls = meta.deletedUrls || {};
          if (deletedUrls[payload.url]) {
            await chrome.storage.local.remove([payload.url, `${payload.url}_meta`]);
            await broadcastByUrl(payload.url, { action: 'refreshHighlights', highlights: [] });
          }
        }
      }
    };

    const bridgeClear = async () => {
      const rootId = await getRootId();
      const children = await chrome.bookmarks.getChildren(rootId);
      for (const node of children) {
        if (node.url) await chrome.bookmarks.remove(node.id);
      }
    };

    globalThis.__bookmarkSyncBridge = {
      get: bridgeGet,
      set: bridgeSet,
      remove: bridgeRemove,
      clear: bridgeClear,
    };

    globalThis.__syncBridgeInstalled = true;
  });
}

function testFileUrl(fileName) {
  return pathToFileURL(path.join(__dirname, fileName)).href;
}

test.describe('Sync scenarios', () => {
  test.beforeEach(async ({ background }) => {
    await waitForSyncReady(background);
    await installStorageSyncBookmarkBridge(background);
  });

  test('sync key removal arrives before tombstone meta update -> eventually treated as user deletion', async ({ background }) => {
    const url = testFileUrl('test-page.html');
    const syncKey = urlToSyncKey(url);
    const highlights = createHighlight('g_remove_then_meta', 'remove-then-meta');

    await background.evaluate(async ({ url, syncKey, highlights }) => {
      await chrome.storage.local.clear();
      await globalThis.__bookmarkSyncBridge.clear();

      await chrome.storage.local.set({
        [url]: highlights,
        [`${url}_meta`]: {
          title: 'test-page',
          lastUpdated: new Date().toISOString(),
          deletedGroupIds: {}
        }
      });

      await globalThis.__bookmarkSyncBridge.set({
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
      await globalThis.__bookmarkSyncBridge.remove(syncKey);
    }, { syncKey });

    // Tombstone update arrives later.
    await waitInBackground(background, 400);
    await background.evaluate(async ({ url }) => {
      const now = Date.now();
      const result = await globalThis.__bookmarkSyncBridge.get('sync_meta');
      const meta = result.sync_meta || { pages: [], totalSize: 0, deletedUrls: {} };
      meta.deletedUrls = meta.deletedUrls || {};
      meta.deletedUrls[url] = now;
      await globalThis.__bookmarkSyncBridge.set({ sync_meta: meta });
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
      const result = await globalThis.__bookmarkSyncBridge.get('sync_meta');
      const meta = result.sync_meta || { pages: [], totalSize: 0, deletedUrls: {} };
      meta.pages.push({ syncKey, url, lastUpdated: now, size: 200 });
      meta.totalSize += 200;
      await globalThis.__bookmarkSyncBridge.set({ sync_meta: meta });

      await globalThis.__bookmarkSyncBridge.set({
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
      await globalThis.__bookmarkSyncBridge.set({
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
      const result = await globalThis.__bookmarkSyncBridge.get('sync_meta');
      const meta = result.sync_meta || { pages: [], totalSize: 0, deletedUrls: {} };
      meta.deletedUrls = meta.deletedUrls || {};
      meta.deletedUrls[url] = now;
      await globalThis.__bookmarkSyncBridge.set({ sync_meta: meta });
      await globalThis.__bookmarkSyncBridge.remove(syncKey);
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
      await globalThis.__bookmarkSyncBridge.set({
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
      await globalThis.__bookmarkSyncBridge.set({
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

    // Initially minimap should be visible (default, and we have highlights)
    const minimap = page.locator('.text-highlighter-minimap');
    await expect(minimap).toBeVisible();

    // Simulate another device disabling minimap
    await background.evaluate(async () => {
      await globalThis.__bookmarkSyncBridge.set({
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

    // Simulate another device adding a custom color
    const customColor = { id: 'custom_123', nameKey: 'customColor', colorNumber: 1, color: '#123456' };
    await background.evaluate(async (customColor) => {
      await globalThis.__bookmarkSyncBridge.set({
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
      await globalThis.__bookmarkSyncBridge.clear();

      await chrome.storage.local.set({
        [url]: highlights,
        [`${url}_meta`]: {
          title: 'test-page2',
          lastUpdated: new Date().toISOString(),
          deletedGroupIds: {}
        }
      });

      await globalThis.__bookmarkSyncBridge.set({
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
      await globalThis.__bookmarkSyncBridge.remove(syncKey);
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
      await globalThis.__bookmarkSyncBridge.clear();

      await chrome.storage.local.set({
        [url1]: highlights1,
        [`${url1}_meta`]: { title: 'page1', lastUpdated: new Date().toISOString(), deletedGroupIds: {} },
        [url2]: highlights2,
        [`${url2}_meta`]: { title: 'page2', lastUpdated: new Date().toISOString(), deletedGroupIds: {} }
      });

      await globalThis.__bookmarkSyncBridge.set({
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
      background.evaluate(async () => await globalThis.__bookmarkSyncBridge.get(['sync_meta'])),
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
