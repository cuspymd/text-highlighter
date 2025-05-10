// 콘텍스트 메뉴 아이템 생성
const COLORS = [
  { id: 'yellow', name: '노란색', color: '#FFFF00' },
  { id: 'green', name: '초록색', color: '#AAFFAA' },
  { id: 'blue', name: '파란색', color: '#AAAAFF' },
  { id: 'pink', name: '분홍색', color: '#FFAAFF' },
  { id: 'orange', name: '주황색', color: '#FFAA55' }
];

// 디버그 모드 설정 - 개발 시 true로 변경
const DEBUG_MODE = false;

// 확장 프로그램이 설치되거나 업데이트될 때 초기 설정
chrome.runtime.onInstalled.addListener(() => {
  if (DEBUG_MODE) console.log('Extension installed/updated. Debug mode:', DEBUG_MODE);

  // 상위 메뉴 항목 생성
  chrome.contextMenus.create({
    id: 'highlight-text',
    title: '텍스트 하이라이트',
    contexts: ['selection']
  });

  // 색상 하위메뉴 생성
  COLORS.forEach(color => {
    chrome.contextMenus.create({
      id: `highlight-${color.id}`,
      parentId: 'highlight-text',
      title: color.name,
      contexts: ['selection']
    });
  });

  // 하이라이트 제거 메뉴 항목 추가
  chrome.contextMenus.create({
    id: 'remove-highlight',
    parentId: 'highlight-text',
    title: '하이라이트 제거',
    contexts: ['selection']
  });
});

// 디버그용 로그 함수
function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log(...args);
  }
}

// 컨텍스트 메뉴 클릭 처리
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const menuId = info.menuItemId;
  debugLog('Context menu clicked:', menuId);

  if (menuId.startsWith('highlight-') && menuId !== 'highlight-text') {
    const colorId = menuId.replace('highlight-', '');
    const color = COLORS.find(c => c.id === colorId);

    if (color) {
      debugLog('Sending highlight action to tab:', tab.id);
      chrome.tabs.sendMessage(tab.id, {
        action: 'highlight',
        color: color.color,
        text: info.selectionText
      }, response => {
        debugLog('Highlight action response:', response);
      });
    }
  }
  else if (menuId === 'remove-highlight') {
    debugLog('Sending remove highlight action to tab:', tab.id);
    chrome.tabs.sendMessage(tab.id, {
      action: 'removeHighlight',
      text: info.selectionText
    }, response => {
      debugLog('Remove highlight action response:', response);
    });
  }
});

// 콘텐츠 스크립트와 통신
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 디버그 모드 상태 요청 처리
  if (message.action === 'getDebugMode') {
    sendResponse({ debugMode: DEBUG_MODE });
    return true;
  }

  if (message.action === 'getHighlights') {
    // 현재 URL에 대한 하이라이트 정보 가져오기
    chrome.storage.local.get([message.url], (result) => {
      debugLog('Sending highlights for URL:', message.url, result[message.url] || []);
      sendResponse({ highlights: result[message.url] || [] });
    });
    return true;
  }

  if (message.action === 'saveHighlights') {
    // 현재 URL에 대한 하이라이트 정보 저장
    const saveData = {};
    saveData[message.url] = message.highlights;
    debugLog('Saving highlights for URL:', message.url, message.highlights);
    chrome.storage.local.set(saveData, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});
