import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import { openHighlight } from '../shared/highlight-navigation.js';

const url = 'https://example.com/article?source=test#section';
const tab = { id: 7, windowId: 2, url, status: 'complete' };

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  chrome.tabs.query.mockResolvedValue([tab]);
  chrome.tabs.update.mockResolvedValue(tab);
  chrome.tabs.create.mockResolvedValue(tab);
  chrome.tabs.get.mockResolvedValue(tab);
  chrome.windows.update.mockResolvedValue({});
  chrome.tabs.sendMessage.mockImplementation(async (_, message) => message.action === 'getRestoredGroupIds'
    ? { success: true, groupIds: ['g'], pendingRestoreMs: 0 } : { success: true });
});

afterEach(() => jest.useRealTimers());

test('reuses the exact URL, focuses its window, and jumps without any storage writes', async () => {
  expect(await openHighlight(url, 'g')).toEqual({ success: true });
  expect(chrome.tabs.update).toHaveBeenCalledWith(7, { active: true });
  expect(chrome.windows.update).toHaveBeenCalledWith(2, { focused: true });
  expect(chrome.tabs.create).not.toHaveBeenCalled();
  expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(7, { action: 'scrollToHighlight', groupId: 'g' });
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
  expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('opens an unchanged URL when no exact tab exists and tolerates a missing windows API', async () => {
  chrome.tabs.query.mockResolvedValue([{ ...tab, url: 'https://example.com/article' }]);
  const update = chrome.windows.update;
  chrome.windows.update = undefined;
  try {
    expect(await openHighlight(url, 'g')).toEqual({ success: true });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url, active: true });
  } finally { chrome.windows.update = update; }
});

test('waits for the content script and delayed restore before jumping', async () => {
  chrome.tabs.sendMessage
    .mockRejectedValueOnce(new Error('No receiver'))
    .mockResolvedValueOnce({ success: true, groupIds: [], pendingRestoreMs: 1000 });
  const result = openHighlight(url, 'g');
  await jest.advanceTimersByTimeAsync(500);
  expect(await result).toEqual({ success: true });
});

test('jumps to an available group even while other groups are pending', async () => {
  chrome.tabs.sendMessage.mockResolvedValueOnce({ success: true, groupIds: ['g'], pendingRestoreMs: 2000 });
  expect(await openHighlight(url, 'g')).toEqual({ success: true });
});

test('reports a missing group only after restoration is complete', async () => {
  chrome.tabs.sendMessage.mockResolvedValue({ success: true, groupIds: [], pendingRestoreMs: 0 });
  expect(await openHighlight(url, 'g')).toEqual({ success: false, reason: 'not-found' });
  expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
});

test.each(['closed', 'changed'])('stops when the tab is %s', async state => {
  if (state === 'closed') chrome.tabs.get.mockRejectedValue(new Error('No tab'));
  else chrome.tabs.get.mockResolvedValue({ ...tab, pendingUrl: 'https://example.com/elsewhere' });
  expect(await openHighlight(url, 'g')).toEqual({ success: false, reason: 'cancelled' });
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
});

test.each(['pending', 'silent'])('bounds %s receivers and clears deadline timers', async state => {
  chrome.tabs.sendMessage.mockImplementation(() => state === 'silent' ? new Promise(() => {})
    : Promise.resolve({ success: true, groupIds: [], pendingRestoreMs: 10000 }));
  const result = openHighlight(url, 'g', { timeoutMs: 1000 });
  await jest.advanceTimersByTimeAsync(1250);
  expect(await result).toEqual({ success: false, reason: 'timeout' });
  expect(jest.getTimerCount()).toBe(0);
});

test('cancels a request that never answers', async () => {
  chrome.tabs.sendMessage.mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const result = openHighlight(url, 'g', { signal: controller.signal });
  await jest.advanceTimersByTimeAsync(0);
  controller.abort();
  expect(await result).toEqual({ success: false, reason: 'cancelled' });
  expect(jest.getTimerCount()).toBe(0);
});

test('rejects unsafe URLs without opening a tab', async () => {
  expect(await openHighlight('javascript:alert(1)', 'g')).toEqual({ success: false, reason: 'unavailable' });
  expect(chrome.tabs.query).not.toHaveBeenCalled();
});

test('does not jump if the address changed while the restore status was being read', async () => {
  chrome.tabs.get.mockResolvedValueOnce(tab).mockResolvedValue({ ...tab, url: 'https://example.com/changed' });
  expect(await openHighlight(url, 'g')).toEqual({ success: false, reason: 'cancelled' });
  expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
});

test('cleans up its polling delay when cancelled', async () => {
  chrome.tabs.sendMessage.mockResolvedValue({ success: true, groupIds: [], pendingRestoreMs: 1000 });
  const controller = new AbortController();
  const result = openHighlight(url, 'g', { signal: controller.signal });
  await jest.advanceTimersByTimeAsync(0);
  controller.abort();
  expect(await result).toEqual({ success: false, reason: 'cancelled' });
  expect(jest.getTimerCount()).toBe(0);
});
