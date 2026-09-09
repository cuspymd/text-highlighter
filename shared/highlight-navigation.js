import { browserAPI } from './browser-api.js';
import { sendMessageToTab } from './tab-broadcast.js';

// Read-only navigation. Never change a saved URL to encode the destination.
export async function openHighlight(url, groupId, { signal, timeoutMs = 15000 } = {}) {
  try {
    if (!['http:', 'https:', 'file:'].includes(new URL(url).protocol) || groupId == null) {
      return { success: false, reason: 'unavailable' };
    }
  } catch {
    return { success: false, reason: 'unavailable' };
  }

  const deadline = Date.now() + timeoutMs;
  // Bound individual API calls too: a receiver can exist but never answer.
  async function bounded(operation) {
    if (signal?.aborted) throw new Error('cancelled');
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('timeout');
    let timer;
    let cancel;
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          if (signal?.aborted) throw new Error('cancelled');
          return operation();
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), remaining);
          cancel = () => reject(new Error('cancelled'));
          signal?.addEventListener('abort', cancel, { once: true });
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }

  try {
    const tabs = await bounded(() => browserAPI.tabs.query({}));
    const existing = tabs.find(tab => tab.url === url && (!tab.pendingUrl || tab.pendingUrl === url));
    const tab = existing
      ? await bounded(() => browserAPI.tabs.update(existing.id, { active: true }))
      : await bounded(() => browserAPI.tabs.create({ url, active: true }));
    if (tab?.id == null) return { success: false, reason: 'unavailable' };
    if (browserAPI.windows?.update && tab.windowId != null) {
      await bounded(() => browserAPI.windows.update(tab.windowId, { focused: true }));
    }

    const id = String(groupId);
    while (true) {
      let current;
      try {
        current = await bounded(() => browserAPI.tabs.get(tab.id));
      } catch (error) {
        if (error.message === 'timeout' || error.message === 'cancelled') throw error;
        return { success: false, reason: 'cancelled' };
      }
      if ((current.pendingUrl && current.pendingUrl !== url) ||
          (current.url && current.url !== url && current.url !== 'about:blank')) {
        return { success: false, reason: 'cancelled' };
      }
      if (current.url === url) {
        const status = await bounded(() => sendMessageToTab(tab.id, { action: 'getRestoredGroupIds' }));
        if (status?.success) {
          if ((status.groupIds || []).some(value => String(value) === id)) {
            // The tab may have navigated while the content script answered.
            const destination = await bounded(() => browserAPI.tabs.get(tab.id));
            if (destination.url !== url || (destination.pendingUrl && destination.pendingUrl !== url)) {
              return { success: false, reason: 'cancelled' };
            }
            const result = await bounded(() => sendMessageToTab(tab.id, { action: 'scrollToHighlight', groupId: id }));
            return result?.success ? { success: true } : { success: false, reason: result?.reason || 'unavailable' };
          }
          if (!(Number(status.pendingRestoreMs) > 0) && current.status === 'complete') {
            return { success: false, reason: 'not-found' };
          }
        }
      }
      let pollTimer;
      try {
        await bounded(() => new Promise(resolve => { pollTimer = setTimeout(resolve, 250); }));
      } finally {
        clearTimeout(pollTimer);
      }
    }
  } catch (error) {
    return { success: false, reason: ['timeout', 'cancelled'].includes(error.message) ? error.message : 'unavailable' };
  }
}
