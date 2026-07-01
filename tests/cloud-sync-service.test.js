import chrome from '../mocks/chrome.js';
import { generateSyncCode } from '../shared/crypto-utils.js';
import {
  mergeBlobs,
  getCloudSyncStatus,
  runCloudSync,
  enableCloudSyncWithNewCode,
  enableCloudSyncWithExistingCode,
  disableCloudSync,
  initCloudSyncAlarm,
} from '../background/cloud-sync-service.js';

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

    it('picks settings from whichever side has the newer settings.updatedAt', () => {
      const local = emptyBlob({ settings: { customColors: [], minimapVisible: false, selectionControlsVisible: true, shortcutColorMap: null, updatedAt: 100 } });
      const remote = emptyBlob({ settings: { customColors: [], minimapVisible: true, selectionControlsVisible: true, shortcutColorMap: null, updatedAt: 200 } });

      const merged = mergeBlobs(local, remote);
      expect(merged.settings.minimapVisible).toBe(true);
    });
  });

  describe('getCloudSyncStatus', () => {
    it('returns disabled defaults when nothing is stored', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({});
      const status = await getCloudSyncStatus();
      expect(status).toEqual({ enabled: false, code: null, lastSyncedAt: null, lastError: null });
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
  });

  describe('enableCloudSyncWithNewCode / enableCloudSyncWithExistingCode', () => {
    it('generates a new code, enables sync, and runs an initial sync', async () => {
      chrome.storage.local.get.mockResolvedValue({});
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ status: 404, ok: false })
        .mockResolvedValueOnce({ ok: true, status: 204 });

      const result = await enableCloudSyncWithNewCode();
      expect(result.code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){12}$/);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ cloudSyncEnabled: true, cloudSyncCode: result.code })
      );
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

  describe('initCloudSyncAlarm', () => {
    it('registers the periodic alarm and an onAlarm listener', () => {
      initCloudSyncAlarm();
      expect(chrome.alarms.create).toHaveBeenCalledWith('cloudSyncAlarm', expect.objectContaining({ periodInMinutes: expect.any(Number) }));
      expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
    });
  });
});
