// 콘텍스트 메뉴 아이템 생성
const COLORS = [
  { id: 'yellow', name: '노란색', color: '#FFFF00' },
  { id: 'green', name: '초록색', color: '#AAFFAA' },
  { id: 'blue', name: '파란색', color: '#AAAAFF' },
  { id: 'pink', name: '분홍색', color: '#FFAAFF' },
  { id: 'orange', name: '주황색', color: '#FFAA55' }
];

// 익스텐션이 설치되거나 업데이트될 때 콘텍스트 메뉴 생성
chrome.runtime.onInstalled.addListener(() => {
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

// 컨텍스트 메뉴 클릭 처리
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const menuId = info.menuItemId;
  
  if (menuId.startsWith('highlight-') && menuId !== 'highlight-text') {
    const colorId = menuId.replace('highlight-', '');
    const color = COLORS.find(c => c.id === colorId);
    
    if (color) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'highlight',
        color: color.color,
        text: info.selectionText
      });
    }
  } 
  else if (menuId === 'remove-highlight') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'removeHighlight',
      text: info.selectionText
    });
  }
});

// 콘텐츠 스크립트와 통신
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getHighlights') {
    // 현재 URL에 대한 하이라이트 정보 가져오기
    chrome.storage.local.get([message.url], (result) => {
      sendResponse({ highlights: result[message.url] || [] });
    });
    return true;
  }
  
  if (message.action === 'saveHighlights') {
    // 현재 URL에 대한 하이라이트 정보 저장
    const saveData = {};
    saveData[message.url] = message.highlights;
    chrome.storage.local.set(saveData, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});
