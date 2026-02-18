import { browserAPI } from './browser-api.js';
import { debugLog } from './logger.js';

/**
 * 모든 탭에 메시지를 전송한다.
 * content script가 주입되지 않은 탭의 에러는 무시한다.
 */
export async function broadcastToAllTabs(message) {
  const tabs = await browserAPI.tabs.query({});
  for (const tab of tabs) {
    try {
      await browserAPI.tabs.sendMessage(tab.id, message);
    } catch (e) {
      // content script가 주입되지 않은 탭은 무시
    }
  }
}

/**
 * 특정 URL과 일치하는 탭에만 메시지를 전송한다.
 * content script가 주입되지 않은 탭의 에러는 무시한다.
 */
export async function broadcastToTabsByUrl(url, message) {
  const tabs = await browserAPI.tabs.query({ url });
  for (const tab of tabs) {
    if (!tab || !tab.id) continue;
    try {
      await browserAPI.tabs.sendMessage(tab.id, message);
    } catch (error) {
      debugLog('Error sending message to tab:', error);
    }
  }
}
