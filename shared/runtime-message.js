import { browserAPI } from './browser-api.js';
import { debugLog } from './logger.js';

/**
 * 백그라운드에 메시지를 보내고 응답을 돌려준다.
 * 답하는 쪽이 없으면 null을 반환한다.
 *
 * service worker가 자고 있거나 재시작 중이면 runtime.sendMessage는 reject된다.
 * 콜백 형태일 때는 같은 상황이 "응답이 undefined"로 도착해서, 호출부의
 * `if (!response || !response.success)` 분기가 그대로 에러 처리를 했다.
 * promise 형태에서 그 분기를 유지하려면 rejection을 여기서 null로 바꿔야 한다.
 * 그러지 않으면 async 핸들러가 unhandled rejection으로 조용히 끝나고, 사용자는
 * 버튼을 눌렀는데 아무 일도 일어나지 않는 화면을 본다.
 *
 * shared/tab-broadcast.js가 탭 메시지에 하는 일과 같은 모양이다.
 * AGENTS.md의 "Extension API calls" 참고.
 */
export async function sendToBackground(message) {
  try {
    return await browserAPI.runtime.sendMessage(message);
  } catch (error) {
    debugLog('No answer from background for:', message && message.action, error);
    return null;
  }
}
