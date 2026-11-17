import chrome from '../mocks/chrome.js';
import { generateSyncCode, deriveSyncKeys, encryptBlob, decryptBlob } from '../shared/crypto-utils.js';
import {
  mergeBlobs,
  isBlobContentEqual,
  getCloudSyncStatus,
  runCloudSync,
  enableCloudSyncWithNewCode,
  enableCloudSyncWithExistingCode,
  disableCloudSync,
  initCloudSyncAlarm,
  ensureCloudSyncAlarm,
  runStartupCloudSync,
} from '../background/cloud-sync-service.js';
import { CLOUD_SYNC_ALARM_PERIOD_MINUTES } from '../constants/cloud-sync-config.js';

function emptyBlob(overrides = {}) {
  return {
    version: 1,
    updatedAt: 0,
    settings: { customColors: [], minimapVisible: true, selectionControlsVisible: true, shortcutColorMap: null, updatedAt: 0 },
    pages: {},
    deletedUrls: {},
    ...overrides,
  };
}

describe('cloud-sync-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('mergeBlobs', () => {
    it('unions pages present on only one side', () => {
      const local = emptyBlob({ pages: { 'https://a.test': { highlights: [{ groupId: 'g1', updatedAt: 100 }], deletedGroupIds: {}, lastUpdated: '2024-01-01T00:00:00.000Z' } } });
      const remote = emptyBlob({ pages: { 'https://b.test': { highlights: [{ groupId: 'g2', updatedAt: 100 }], deletedGroupIds: {}, lastUpdated: '2024-01-01T00:00:00.000Z' } } });

      const merged = mergeBlobs(local, remote);
      expect(Object.keys(merged.pages).sort()).toEqual(['https://a.test', 'https://b.test']);
    });

    it('merges highlights for the same page via mergeHighlights (favors newer updatedAt)', () => {
      const local = emptyBlob({
        pages: { 'https://a.test': { highlights: [{ groupId: 'g1', text: 'old', updatedAt: 100 }], deletedGroupIds: {}, lastUpdated: '2024-01-01T00:00:00.000Z' } },
      });
      const remote = emptyBlob({
        pages: { 'https://a.test': { highlights: [{ groupId: 'g1', text: 'new', updatedAt: 200 }], deletedGroupIds: {}, lastUpdated: '2024-01-02T00:00:00.000Z' } },
      });

      const merged = mergeBlobs(local, remote);
      expect(merged.pages['https://a.test'].highlights).toHaveLength(1);
      expect(merged.pages['https://a.test'].highlights[0].text).toBe('new');
    });

    it('drops a page whose tombstone is newer than both sides (stays deleted)', () => {
      const now = Date.now();
      const local = emptyBlob({
        pages: { 'https://a.test': { highlights: [{ groupId: 'g1', updatedAt: 1 }], deletedGroupIds: {}, lastUpdated: new Date(now - 10000).toISOString() } },
        deletedUrls: { 'https://a.test': now },
      });
      const remote = emptyBlob();

      const merged = mergeBlobs(local, remote);
      expect(merged.pages['https://a.test']).toBeUndefined();
    });

    it('keeps a page recreated after deletion (lastUpdated newer than tombstone)', () => {
      const now = Date.now();
      const local = emptyBlob({ deletedUrls: { 'https://a.test': now - 10000 } });
      const remote = emptyBlob({
        pages: { 'https://a.test': { highlights: [{ groupId: 'g1', updatedAt: now }], deletedGroupIds: {}, lastUpdated: new Date(now).toISOString() } },
      });

      const merged = mergeBlobs(local, remote);
      expect(merged.pages['https://a.test']).toBeDefined();
      expect(merged.pages['https://a.test'].highlights).toHaveLength(1);
    });

    it('keeps the newer duplicate URL tombstone so an older remote tombstone cannot resurrect a page', () => {
      const now = Date.now();
      const url = 'https://a.test';
      const localDelete = now - 1000;
      const remoteRecreate = now - 2000;
      const remoteOldDelete = now - 3000;
      const local = emptyBlob({ deletedUrls: { [url]: localDelete } });
      const remote = emptyBlob({
        pages: { [url]: { highlights: [{ groupId: 'g1', updatedAt: remoteRecreate }], deletedGroupIds: {}, lastUpdated: new Date(remoteRecreate).toISOString() } },
        deletedUrls: { [url]: remoteOldDelete },
      });

      const merged = mergeBlobs(local, remote);
      expect(merged.deletedUrls[url]).toBe(localDelete);
      expect(merged.pages[url]).toBeUndefined();
    });

    it('keeps the newer duplicate URL tombstone independent of merge direction', () => {
      const now = Date.now();
      const url = 'https://a.test';
      const local = emptyBlob({ deletedUrls: { [url]: now - 3000 } });
      const remote = emptyBlob({ deletedUrls: { [url]: now - 1000 } });

      const merged = mergeBlobs(local, remote);
      expect(merged.deletedUrls[url]).toBe(now - 1000);
    });

    it('picks settings from whichever side has the newer settings.updatedAt', () => {
      const local = emptyBlob({ settings: { customColors: [], minimapVisible: false, selectionControlsVisible: true, shortcutColorMap: null, updatedAt: 100 } });
      const remote = emptyBlob({ settings: { customColors: [], minimapVisible: true, selectionControlsVisible: true, shortcutColorMap: null, updatedAt: 200 } });

      const merged = mergeBlobs(local, remote);
      expect(merged.settings.minimapVisible).toBe(true);
    });
  });

  describe('isBlobContentEqual', () => {
    it('treats identical content as equal even when the top-level updatedAt stamp differs', () => {
      const a = emptyBlob({ updatedAt: 1 });
      const b = emptyBlob({ updatedAt: 2 });
      expect(isBlobContentEqual(a, b)).toBe(true);
    });

    it('ignores highlight array order within a page (Map-insertion-order artifact of mergeHighlights)', () => {
      const page = (highlights) => ({ title: 'A', lastUpdated: '2024-01-01T00:00:00.000Z', highlights, deletedGroupIds: {} });
      const a = emptyBlob({ pages: { 'https://a.test': page([{ groupId: 'g1', updatedAt: 1 }, { groupId: 'g2', updatedAt: 1 }]) } });
      const b = emptyBlob({ pages: { 'https://a.test': page([{ groupId: 'g2', updatedAt: 1 }, { groupId: 'g1', updatedAt: 1 }]) } });
      expect(isBlobContentEqual(a, b)).toBe(true);
    });

    it('ignores deletedUrls / deletedGroupIds key order (spread-merge artifact)', () => {
      const a = emptyBlob({ deletedUrls: { 'https://a.test': 1, 'https://b.test': 2 } });
      const b = emptyBlob({ deletedUrls: { 'https://b.test': 2, 'https://a.test': 1 } });
      expect(isBlobContentEqual(a, b)).toBe(true);
    });

    it('still detects a real content difference (new highlight group added)', () => {
      const page = (highlights) => ({ title: 'A', lastUpdated: '2024-01-01T00:00:00.000Z', highlights, deletedGroupIds: {} });
      const a = emptyBlob({ pages: { 'https://a.test': page([{ groupId: 'g1', updatedAt: 1 }]) } });
      const b = emptyBlob({ pages: { 'https://a.test': page([{ groupId: 'g1', updatedAt: 1 }, { groupId: 'g2', updatedAt: 1 }]) } });
      expect(isBlobContentEqual(a, b)).toBe(false);
    });
  });

  describe('getCloudSyncStatus', () => {
    it('returns disabled defaults when nothing is stored', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({});
      const status = await getCloudSyncStatus();
      expect(status).toEqual({
        enabled: false,
        code: null,
        lastSyncedAt: null,
        lastError: null,
        lastTrimmedCount: 0,
      });
    });
  });

  describe('runCloudSync', () => {
    it('no-ops when cloud sync is disabled', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({ cloudSyncEnabled: false });
      global.fetch = jest.fn();

      const result = await runCloudSync();
      expect(result.success).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('pulls (404 = no remote data yet), merges, and pushes when enabled', async () => {
      const code = generateSyncCode();
      chrome.storage.local.get.mockImplementation((keys) => {
        if (keys === null) {
          return Promise.resolve({
            'https://a.test': [{ groupId: 'g1', updatedAt: 1 }],
            'https://a.test_meta': { title: 'A', lastUpdated: '2024-01-01T00:00:00.000Z', deletedGroupIds: {} },
          });
        }
        return Promise.resolve({ cloudSyncEnabled: true, cloudSyncCode: code });
      });

      global.fetch = jest.fn()
        .mockResolvedValueOnce({ status: 404, ok: false }) // GET
        .mockResolvedValueOnce({ ok: true, status: 204 }); // PUT

      const result = await runCloudSync();

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch.mock.calls[1][1].method).toBe('PUT');

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ cloudSyncLastSyncedAt: expect.any(Number), cloudSyncLastError: null })
      );
    });

    it('skips the PUT when the merged blob is unchanged from the fetched remote blob', async () => {
      const code = generateSyncCode();
      const { encryptionKey } = await deriveSyncKeys(code);

      // Remote already holds exactly what local has (same page, reordered highlights
      // to double-check the skip survives the order-insensitive comparison).
      const remoteBlob = emptyBlob({
        pages: {
          'https://a.test': {
            title: 'A',
            lastUpdated: '2024-01-01T00:00:00.000Z',
            highlights: [{ groupId: 'g2', updatedAt: 1 }, { groupId: 'g1', updatedAt: 1 }],
            deletedGroupIds: {},
          },
        },
      });
      const envelope = await encryptBlob(remoteBlob, encryptionKey);

      chrome.storage.local.get.mockImplementation((keys) => {
        if (keys === null) {
          return Promise.resolve({
            'https://a.test': [{ groupId: 'g1', updatedAt: 1 }, { groupId: 'g2', updatedAt: 1 }],
            'https://a.test_meta': { title: 'A', lastUpdated: '2024-01-01T00:00:00.000Z', deletedGroupIds: {} },
          });
        }
        return Promise.resolve({ cloudSyncEnabled: true, cloudSyncCode: code });
      });

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => envelope,
      });

      const result = await runCloudSync();

      expect(result.success).toBe(true);
      // Only the GET should have happened; the PUT is skipped because merged === remote.
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // A profile that upgraded into the one-click setting has no local value for
    // it, and every unrelated save stamps this device's settings as the newest.
    // Sending the absent key as `false` would hand the merge a "no" nobody
    // chose; dropping it would lose the cloud's record of the value, so the
    // next device to pair would read nothing at all.
    it('carries a setting this device has no value for through the merge it wins', async () => {
      const code = generateSyncCode();
      const { encryptionKey } = await deriveSyncKeys(code);

      const remoteBlob = emptyBlob({
        settings: {
          customColors: [],
          minimapVisible: true,
          selectionControlsVisible: true,
          oneClickHighlightEnabled: true,
          shortcutColorMap: null,
          updatedAt: 1000,
        },
      });
      const envelope = await encryptBlob(remoteBlob, encryptionKey);

      chrome.storage.local.get.mockImplementation((keys) => {
        if (keys === null) {
          return Promise.resolve({
            // No oneClickHighlightEnabled: this device has never had one. Its
            // settings are the newer ones, so the merge takes them.
            cloudSyncSettingsUpdatedAt: 2000,
            'https://a.test': [{ groupId: 'g1', updatedAt: 1 }],
            'https://a.test_meta': { title: 'A', lastUpdated: '2024-01-01T00:00:00.000Z', deletedGroupIds: {} },
          });
        }
        return Promise.resolve({ cloudSyncEnabled: true, cloudSyncCode: code });
      });

      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => envelope })
        .mockResolvedValueOnce({ ok: true, status: 204 });

      const result = await runCloudSync();

      expect(result.success).toBe(true);
      const pushed = await decryptBlob(JSON.parse(global.fetch.mock.calls[1][1].body), encryptionKey);
      expect(pushed.settings.oneClickHighlightEnabled).toBe(true);
      // Nothing wrote the absent value as `false` here either - this device
      // adopts the one it just learned about.
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ oneClickHighlightEnabled: true }),
      );
    });

    it('sends no value for a setting no device has one for', async () => {
      const code = generateSyncCode();
      const { encryptionKey } = await deriveSyncKeys(code);

      const remoteBlob = emptyBlob({ settings: { ...emptyBlob().settings, updatedAt: 1000 } });
      const envelope = await encryptBlob(remoteBlob, encryptionKey);

      chrome.storage.local.get.mockImplementation((keys) => {
        if (keys === null) {
          return Promise.resolve({
            cloudSyncSettingsUpdatedAt: 2000,
            'https://a.test': [{ groupId: 'g1', updatedAt: 1 }],
            'https://a.test_meta': { title: 'A', lastUpdated: '2024-01-01T00:00:00.000Z', deletedGroupIds: {} },
          });
        }
        return Promise.resolve({ cloudSyncEnabled: true, cloudSyncCode: code });
      });

      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => envelope })
        .mockResolvedValueOnce({ ok: true, status: 204 });

      await runCloudSync();

      const pushed = await decryptBlob(JSON.parse(global.fetch.mock.calls[1][1].body), encryptionKey);
      expect(pushed.settings).not.toHaveProperty('oneClickHighlightEnabled');
    });

    it('records the error and returns success:false when the fetch fails', async () => {
      const code = generateSyncCode();
      chrome.storage.local.get.mockImplementation((keys) => {
        if (keys === null) return Promise.resolve({});
        return Promise.resolve({ cloudSyncEnabled: true, cloudSyncCode: code });
      });
      global.fetch = jest.fn().mockResolvedValueOnce({ status: 500, ok: false });

      const result = await runCloudSync();
      expect(result.success).toBe(false);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ cloudSyncLastError: expect.any(String) })
      );
    });

    it('drops a lone page that alone exceeds the size limit instead of failing the sync', async () => {
      // A second, tiny page ensures there's still something new to push once the giant one is
      // dropped — otherwise the fitted blob would coincidentally be as empty as the "no remote
      // data yet" placeholder and the PUT would (correctly) be skipped, which is covered separately.
      const code = generateSyncCode();
      chrome.storage.local.get.mockImplementation((keys) => {
        if (keys === null) {
          return Promise.resolve({
            'https://large.test': [{ groupId: 'g1', text: 'x'.repeat(1_050_000), updatedAt: 1 }],
            'https://large.test_meta': { title: 'Large', lastUpdated: '2024-01-01T00:00:00.000Z', deletedGroupIds: {} },
            'https://small.test': [{ groupId: 'g2', text: 'small', updatedAt: 2 }],
            'https://small.test_meta': { title: 'Small', lastUpdated: '2024-06-01T00:00:00.000Z', deletedGroupIds: {} },
          });
        }
        return Promise.resolve({ cloudSyncEnabled: true, cloudSyncCode: code });
      });
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ status: 404, ok: false }) // GET
        .mockResolvedValueOnce({ ok: true, status: 204 }); // PUT

      const result = await runCloudSync();

      expect(result.success).toBe(true);
      expect(result.trimmedCount).toBe(1);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
        cloudSyncLastTrimmedCount: 1,
        cloudSyncLastError: null,
      }));
    });

    it('still pushes an empty fitted blob when the remote is missing (404), so the KV record gets created (regression: PR #106 review)', async () => {
      // A 404 yields the same empty shape as a genuinely-empty remote blob (see emptyBlob()).
      // If trimming a lone oversized page also lands on an empty fitted blob, treating that as
      // "unchanged, skip the PUT" would mean the remote key never gets created — leaving
      // enableCloudSyncWithExistingCode's allowMissingRemote:false pairing fetch permanently 404ing.
      const code = generateSyncCode();
      chrome.storage.local.get.mockImplementation((keys) => {
        if (keys === null) {
          return Promise.resolve({
            'https://large.test': [{ groupId: 'g1', text: 'x'.repeat(1_050_000), updatedAt: 1 }],
            'https://large.test_meta': { title: 'Large', lastUpdated: '2024-01-01T00:00:00.000Z', deletedGroupIds: {} },
          });
        }
        return Promise.resolve({ cloudSyncEnabled: true, cloudSyncCode: code });
      });
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ status: 404, ok: false }) // GET
        .mockResolvedValueOnce({ ok: true, status: 204 }); // PUT

      const result = await runCloudSync();

      expect(result.success).toBe(true);
      expect(result.trimmedCount).toBe(1);
      expect(global.fetch).toHaveBeenCalledTimes(2); // GET + PUT; the missing remote forces the push despite empty fitted content.
      expect(global.fetch.mock.calls[1][1].method).toBe('PUT');
      expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
        cloudSyncLastTrimmedCount: 1,
      }));
    });

    it('keeps the most recently updated pages and drops the oldest ones when combined data exceeds the limit', async () => {
      const code = generateSyncCode();
      const { encryptionKey } = await deriveSyncKeys(code);

      chrome.storage.local.get.mockImplementation((keys) => {
        if (keys === null) {
          return Promise.resolve({
            'https://old.test': [{ groupId: 'g1', text: 'x'.repeat(700_000), updatedAt: 1 }],
            'https://old.test_meta': { title: 'Old', lastUpdated: '2024-01-01T00:00:00.000Z', deletedGroupIds: {} },
            'https://new.test': [{ groupId: 'g2', text: 'y'.repeat(700_000), updatedAt: 2 }],
            'https://new.test_meta': { title: 'New', lastUpdated: '2024-06-01T00:00:00.000Z', deletedGroupIds: {} },
          });
        }
        return Promise.resolve({ cloudSyncEnabled: true, cloudSyncCode: code });
      });

      let pushedBody = null;
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ status: 404, ok: false }) // GET
        .mockImplementationOnce((url, options) => {
          pushedBody = options.body;
          return Promise.resolve({ ok: true, status: 204 }); // PUT
        });

      const result = await runCloudSync();

      expect(result.success).toBe(true);
      expect(result.trimmedCount).toBe(1);
      expect(new TextEncoder().encode(pushedBody).byteLength).toBeLessThanOrEqual(1_000_000);

      const decrypted = await decryptBlob(JSON.parse(pushedBody), encryptionKey);
      expect(Object.keys(decrypted.pages)).toEqual(['https://new.test']);
    });

    it('does not re-PUT every cycle once the remote already holds the trimmed-down state (regression: PR #106 review)', async () => {
      // Local storage still holds the oldest page (trimming never removes it locally, only from
      // the pushed copy). If the equality check compared the *untrimmed* merged blob against
      // remote, it would never match and every sync cycle would re-push identical content.
      const code = generateSyncCode();
      const { encryptionKey } = await deriveSyncKeys(code);

      const remoteBlob = emptyBlob({
        pages: {
          'https://new.test': {
            title: 'New',
            lastUpdated: '2024-06-01T00:00:00.000Z',
            highlights: [{ groupId: 'g2', text: 'y'.repeat(700_000), updatedAt: 2 }],
            deletedGroupIds: {},
          },
        },
      });
      const envelope = await encryptBlob(remoteBlob, encryptionKey);

      chrome.storage.local.get.mockImplementation((keys) => {
        if (keys === null) {
          return Promise.resolve({
            'https://old.test': [{ groupId: 'g1', text: 'x'.repeat(700_000), updatedAt: 1 }],
            'https://old.test_meta': { title: 'Old', lastUpdated: '2024-01-01T00:00:00.000Z', deletedGroupIds: {} },
            'https://new.test': [{ groupId: 'g2', text: 'y'.repeat(700_000), updatedAt: 2 }],
            'https://new.test_meta': { title: 'New', lastUpdated: '2024-06-01T00:00:00.000Z', deletedGroupIds: {} },
          });
        }
        return Promise.resolve({ cloudSyncEnabled: true, cloudSyncCode: code });
      });

      global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => envelope });

      const result = await runCloudSync();

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(1); // GET only; no PUT, since the fitted blob already matches remote.
      // Still reported even though the PUT was skipped this round (regression: PR #106 review).
      expect(result.trimmedCount).toBe(1);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
        cloudSyncLastTrimmedCount: 1,
      }));
    });

    it('still throws the size error when trimming every page cannot bring the payload under the limit', async () => {
      const code = generateSyncCode();
      chrome.storage.local.get.mockImplementation((keys) => {
        if (keys === null) {
          return Promise.resolve({ customColors: ['x'.repeat(1_050_000)] });
        }
        return Promise.resolve({ cloudSyncEnabled: true, cloudSyncCode: code });
      });
      global.fetch = jest.fn().mockResolvedValueOnce({ status: 404, ok: false });

      const result = await runCloudSync();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cloud sync data too large');
      expect(global.fetch).toHaveBeenCalledTimes(1); // GET only; no page data left to trim, PUT never attempted.
      expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
        cloudSyncLastError: expect.stringContaining('Cloud sync data too large'),
      }));
    });
  });

  describe('enableCloudSyncWithNewCode / enableCloudSyncWithExistingCode', () => {
    it('generates a new code, enables sync, and runs an initial sync', async () => {
      const localStore = {};
      chrome.storage.local.set.mockImplementation((items) => {
        Object.assign(localStore, items);
        return Promise.resolve();
      });
      chrome.storage.local.get.mockImplementation((keys) => {
        if (keys === null) return Promise.resolve({});
        if (Array.isArray(keys)) {
          return Promise.resolve(Object.fromEntries(keys.map((key) => [key, localStore[key]])));
        }
        return Promise.resolve({ [keys]: localStore[keys] });
      });
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ status: 404, ok: false })
        .mockResolvedValueOnce({ ok: true, status: 204 });

      const result = await enableCloudSyncWithNewCode();
      expect(result.code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){12}$/);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ cloudSyncEnabled: true, cloudSyncCode: result.code })
      );
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch.mock.calls[1][1].method).toBe('PUT');
    });

    it('rejects a valid-looking existing code when no remote blob exists', async () => {
      const code = generateSyncCode();
      global.fetch = jest.fn().mockResolvedValueOnce({ status: 404, ok: false });

      const result = await enableCloudSyncWithExistingCode(code);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found|incorrect/i);
      expect(chrome.storage.local.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ cloudSyncEnabled: true, cloudSyncCode: code })
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch.mock.calls[0][1]).toBeUndefined();
    });

    it('rejects a malformed pairing code without touching storage', async () => {
      const result = await enableCloudSyncWithExistingCode('not-a-valid-code!!');
      expect(result.success).toBe(false);
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
  });

  describe('disableCloudSync', () => {
    it('sets cloudSyncEnabled to false', async () => {
      await disableCloudSync();
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ cloudSyncEnabled: false });
    });
  });

  // runCloudSync merges a snapshot of storage.local with the remote copy, and
  // storage.local keeps changing while the remote round trip is in flight.
  // These tests hold the GET open, make the change a background handler would
  // make in that time, then let the cycle finish.
  describe('runCloudSync - writes that land during the remote round trip', () => {
    const url = 'https://a.test';
    const metaKey = `${url}_meta`;
    const longAgo = '2024-01-01T00:00:00.000Z';
    let code;

    const clone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

    function useLocalStore(initial) {
      const store = { cloudSyncEnabled: true, cloudSyncCode: code, ...initial };
      chrome.storage.local.get.mockImplementation((keys) => {
        if (keys === null) return Promise.resolve(clone(store));
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        const out = {};
        list.forEach(k => { if (k in store) out[k] = clone(store[k]); });
        return Promise.resolve(out);
      });
      chrome.storage.local.set.mockImplementation((items) => {
        Object.assign(store, clone(items));
        return Promise.resolve();
      });
      chrome.storage.local.remove.mockImplementation((keys) => {
        [].concat(keys).forEach(k => { delete store[k]; });
        return Promise.resolve();
      });
      return store;
    }

    // GET answers only when the test calls the returned release(); PUT answers at once.
    async function holdRemoteGet(remoteBlob) {
      const { encryptionKey } = await deriveSyncKeys(code);
      const envelope = await encryptBlob(remoteBlob, encryptionKey);
      const releases = [];
      global.fetch = jest.fn((_url, init) => {
        if (init && init.method === 'PUT') return Promise.resolve({ ok: true, status: 204 });
        return new Promise(resolve => {
          releases.push(() => resolve({ ok: true, status: 200, json: async () => envelope }));
        });
      });
      return {
        getCount: () => global.fetch.mock.calls.filter(([, init]) => !init || init.method !== 'PUT').length,
        release: () => releases.shift()(),
      };
    }

    async function waitUntil(condition) {
      for (let i = 0; i < 200 && !condition(); i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      expect(condition()).toBe(true);
    }

    const groupIds = (store) => (store[url] || []).map(g => g.groupId).sort();

    beforeEach(() => {
      code = generateSyncCode();
    });

    it('keeps a highlight saved during the round trip when the remote also changed the page', async () => {
      const store = useLocalStore({
        [url]: [{ groupId: 'g1', updatedAt: 1 }],
        [metaKey]: { title: 'A', lastUpdated: longAgo, deletedGroupIds: {} },
      });
      const remote = await holdRemoteGet(emptyBlob({
        pages: { [url]: { title: 'A', lastUpdated: '2024-01-02T00:00:00.000Z', highlights: [{ groupId: 'g1', updatedAt: 1 }, { groupId: 'gRemote', updatedAt: 2 }], deletedGroupIds: {} } },
      }));

      const sync = runCloudSync();
      await waitUntil(() => remote.getCount() === 1);
      store[url] = [{ groupId: 'g1', updatedAt: 1 }, { groupId: 'gNew', updatedAt: Date.now() }];
      store[metaKey] = { title: 'A', lastUpdated: new Date().toISOString(), deletedGroupIds: {} };
      remote.release();

      expect((await sync).success).toBe(true);
      expect(groupIds(store)).toEqual(['g1', 'gNew', 'gRemote']);
    });

    it('does not bring back a group deleted during the round trip, nor drop its tombstone', async () => {
      const store = useLocalStore({
        [url]: [{ groupId: 'g1', updatedAt: 1 }, { groupId: 'g2', updatedAt: 1 }],
        [metaKey]: { title: 'A', lastUpdated: longAgo, deletedGroupIds: {} },
      });
      const remote = await holdRemoteGet(emptyBlob({
        pages: { [url]: { title: 'A', lastUpdated: '2024-01-02T00:00:00.000Z', highlights: [{ groupId: 'g1', updatedAt: 1 }, { groupId: 'g2', updatedAt: 1 }, { groupId: 'gRemote', updatedAt: 2 }], deletedGroupIds: {} } },
      }));

      const sync = runCloudSync();
      await waitUntil(() => remote.getCount() === 1);
      const deletedAt = Date.now();
      store[url] = [{ groupId: 'g1', updatedAt: 1 }];
      store[metaKey] = { title: 'A', lastUpdated: new Date(deletedAt).toISOString(), deletedGroupIds: { g2: deletedAt } };
      remote.release();

      expect((await sync).success).toBe(true);
      expect(groupIds(store)).toEqual(['g1', 'gRemote']);
      expect(store[metaKey].deletedGroupIds.g2).toBe(deletedAt);
    });

    it('does not bring back a page cleared during the round trip, nor drop its URL tombstone', async () => {
      const store = useLocalStore({
        [url]: [{ groupId: 'g1', updatedAt: 1 }],
        [metaKey]: { title: 'A', lastUpdated: longAgo, deletedGroupIds: {} },
      });
      const remote = await holdRemoteGet(emptyBlob({
        pages: { [url]: { title: 'A', lastUpdated: '2024-01-02T00:00:00.000Z', highlights: [{ groupId: 'g1', updatedAt: 1 }, { groupId: 'gRemote', updatedAt: 2 }], deletedGroupIds: {} } },
      }));

      const sync = runCloudSync();
      await waitUntil(() => remote.getCount() === 1);
      // What syncRemoveHighlights + cleanupEmptyHighlightData leave behind.
      const deletedAt = Date.now();
      store.cloudSyncDeletedUrls = { [url]: deletedAt };
      delete store[url];
      delete store[metaKey];
      remote.release();

      expect((await sync).success).toBe(true);
      expect(store[url]).toBeUndefined();
      expect(store[metaKey]).toBeUndefined();
      expect(store.cloudSyncDeletedUrls[url]).toBe(deletedAt);
    });

    it('does not rewrite a page the merge leaves unchanged', async () => {
      useLocalStore({
        [url]: [{ groupId: 'g1', updatedAt: 1 }],
        [metaKey]: { title: 'A', lastUpdated: longAgo, deletedGroupIds: {} },
      });
      const remote = await holdRemoteGet(emptyBlob({
        pages: { [url]: { title: 'A', lastUpdated: longAgo, highlights: [{ groupId: 'g1', updatedAt: 1 }], deletedGroupIds: {} } },
      }));

      const sync = runCloudSync();
      await waitUntil(() => remote.getCount() === 1);
      remote.release();

      expect((await sync).success).toBe(true);
      const pageWrites = chrome.storage.local.set.mock.calls.filter(([items]) => url in items);
      expect(pageWrites).toHaveLength(0);
    });

    it('runs one cycle at a time, and calls made during it share one follow-up cycle', async () => {
      useLocalStore({});
      const remote = await holdRemoteGet(emptyBlob());

      const first = runCloudSync();
      await waitUntil(() => remote.getCount() === 1);
      const second = runCloudSync();
      const third = runCloudSync();
      expect(third).toBe(second);

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(remote.getCount()).toBe(1);

      remote.release();
      expect((await first).success).toBe(true);
      await waitUntil(() => remote.getCount() === 2);
      remote.release();
      expect((await second).success).toBe(true);
      expect(remote.getCount()).toBe(2);
    });
  });

  // The worker restarts on every tab switch and page load, and each start runs
  // this setup again. None of it may restart the alarm's countdown or sync on
  // its own account.
  describe('alarm and startup sync', () => {
    // runCloudSync reads the status first; counting those reads counts the cycles.
    const syncStatusReads = () => chrome.storage.local.get.mock.calls
      .filter(([keys]) => Array.isArray(keys) && keys.includes('cloudSyncEnabled')).length;

    beforeEach(() => {
      chrome.storage.local.get.mockImplementation(() => Promise.resolve({ cloudSyncEnabled: false }));
      global.fetch = jest.fn();
    });

    it('registers the onAlarm and runtime.onStartup listeners without touching the alarm', () => {
      initCloudSyncAlarm();
      expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
      expect(chrome.runtime.onStartup.addListener).toHaveBeenCalledTimes(1);
      expect(chrome.alarms.create).not.toHaveBeenCalled();
    });

    it('creates the alarm when there is none, and says so', async () => {
      chrome.alarms.get.mockResolvedValueOnce(undefined);

      await expect(ensureCloudSyncAlarm()).resolves.toBe(true);
      expect(chrome.alarms.create).toHaveBeenCalledWith('cloudSyncAlarm', { periodInMinutes: CLOUD_SYNC_ALARM_PERIOD_MINUTES });
    });

    it('leaves an existing alarm alone, so its countdown is not restarted', async () => {
      chrome.alarms.get.mockResolvedValueOnce({ name: 'cloudSyncAlarm', periodInMinutes: CLOUD_SYNC_ALARM_PERIOD_MINUTES });

      await expect(ensureCloudSyncAlarm()).resolves.toBe(false);
      expect(chrome.alarms.create).not.toHaveBeenCalled();
    });

    it('replaces an alarm left with a different period by an older version', async () => {
      chrome.alarms.get.mockResolvedValueOnce({ name: 'cloudSyncAlarm', periodInMinutes: CLOUD_SYNC_ALARM_PERIOD_MINUTES + 5 });

      await expect(ensureCloudSyncAlarm()).resolves.toBe(true);
      expect(chrome.alarms.create).toHaveBeenCalledTimes(1);
    });

    it('runs a sync when the alarm fires, and only for its own alarm', async () => {
      initCloudSyncAlarm();
      const onAlarm = chrome.alarms.onAlarm.addListener.mock.calls[0][0];

      onAlarm({ name: 'someOtherAlarm' });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(syncStatusReads()).toBe(0);

      onAlarm({ name: 'cloudSyncAlarm' });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(syncStatusReads()).toBe(1);
    });

    // One module instance per test file, so this is the only test that may
    // call the startup sync: the first call spends the once-per-worker budget.
    it('runs the startup sync once per worker, however many triggers ask for it', async () => {
      initCloudSyncAlarm();
      const onStartup = chrome.runtime.onStartup.addListener.mock.calls[0][0];

      onStartup();
      runStartupCloudSync();
      onStartup();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(syncStatusReads()).toBe(1);
    });
  });
});
