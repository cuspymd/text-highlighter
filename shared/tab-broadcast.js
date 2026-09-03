import { browserAPI } from './browser-api.js';
import { debugLog } from './logger.js';

/**
 * 탭 하나에 메시지를 보내고 응답을 돌려준다.
 * 받는 쪽이 없으면 null을 반환한다.
 *
 * browserAPI는 polyfill이 아니라 브라우저의 확장 네임스페이스 그 자체다.
 * Firefox의 tabs.sendMessage는 세 번째 인자가 options이고 응답을 promise로
 * 돌려주므로, 거기에 콜백을 넘기면 영영 호출되지 않는다. Chrome MV3도 promise를
 * 반환하니 promise 형태가 양쪽에서 동작하는 유일한 형태다.
 *
 * 탭 메시지는 전부 이 함수를 거친다. 콜백을 넘길 자리를 호출부에 남기지 않기
 * 위해서다. AGENTS.md의 "Extension API calls" 참고.
 */
export async function sendMessageToTab(tabId, message) {
  try {
    return await browserAPI.tabs.sendMessage(tabId, message);
  } catch (error) {
    // content script가 주입되지 않은 탭 등, 받는 쪽이 없으면 reject된다
    debugLog('Error sending message to tab:', message && message.action, error);
    return null;
  }
}

/**
 * 모든 탭에 메시지를 전송한다.
 * content script가 주입되지 않은 탭의 에러는 무시한다.
 */
export async function broadcastToAllTabs(message) {
  const tabs = await browserAPI.tabs.query({});
  for (const tab of tabs) {
    await sendMessageToTab(tab.id, message);
  }
}

/**
 * 특정 URL과 일치하는 탭에만 메시지를 전송한다.
 * content script가 주입되지 않은 탭의 에러는 무시한다.
 */
export async function broadcastToTabsByUrl(url, message, { excludeTabId } = {}) {
  const tabs = await browserAPI.tabs.query({ url });
  for (const tab of tabs) {
    if (!tab || !tab.id) continue;
    if (excludeTabId !== undefined && tab.id === excludeTabId) continue;
    await sendMessageToTab(tab.id, message);
  }
}
