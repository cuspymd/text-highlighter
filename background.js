// constants.js 파일에서 COLORS 변수를 임포트합니다.
import { COLORS } from './constants.js';

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

  // 단축키 정보를 가져와서 컨텍스트 메뉴에 표시
  chrome.commands.getAll((commands) => {
    const commandShortcuts = {};
    commands.forEach(command => {
      if (command.name.startsWith('highlight_') && command.shortcut) {
        // commands.json에 정의된 command name과 매칭하여 단축키 저장
        commandShortcuts[command.name] = ` (${command.shortcut})`;
      }
    });

    COLORS.forEach(color => {
      const commandName = `highlight_${color.id}`;
      const shortcutDisplay = commandShortcuts[commandName] || '';

      chrome.contextMenus.create({
        id: `highlight-${color.id}`,
        parentId: 'highlight-text',
        title: `${color.name}${shortcutDisplay}`, // 색상 이름 뒤에 단축키 정보 추가
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
    // COLORS 변수를 직접 사용
    const color = COLORS.find(c => c.id === colorId);

    if (color) {
      debugLog('Sending highlight action to tab:', tab.id);
      // Content Script에 하이라이트 액션 및 색상 정보 전달
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
    // Content Script에 하이라이트 제거 액션 전달
    chrome.tabs.sendMessage(tab.id, {
      action: 'removeHighlight',
      text: info.selectionText
    }, response => {
      debugLog('Remove highlight action response:', response);
    });
  }
});

// 단축키 명령 처리
chrome.commands.onCommand.addListener((command) => {
  debugLog('Command received:', command);
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (activeTab) {
      let targetColor = null;
      // 단축키에 따라 색상 결정
      switch (command) {
        case 'highlight_yellow':
          targetColor = COLORS.find(c => c.id === 'yellow')?.color;
          break;
        case 'highlight_green':
          targetColor = COLORS.find(c => c.id === 'green')?.color;
          break;
        case 'highlight_blue':
          targetColor = COLORS.find(c => c.id === 'blue')?.color;
          break;
        case 'highlight_pink':
          targetColor = COLORS.find(c => c.id === 'pink')?.color;
          break;
      }

      // 색상 하이라이트 명령 처리
      if (targetColor) {
        debugLog('Sending highlight action to tab:', activeTab.id, 'with color:', targetColor);
        chrome.tabs.sendMessage(activeTab.id, {
          action: 'highlight',
          color: targetColor
        }, response => {
          debugLog('Highlight action response:', response);
        });
      }
    }
  });
});

// 콘텐츠 스크립트와 통신 (메시지 수신 처리)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 디버그 모드 상태 요청 처리
  if (message.action === 'getDebugMode') {
    sendResponse({ debugMode: DEBUG_MODE });
    return true; // 비동기 응답을 위해 true 반환
  }

  // content.js에서 COLORS 정보 요청 시 처리
  if (message.action === 'getColors') {
    debugLog('Content script requested COLORS.');
    sendResponse({ colors: COLORS }); // COLORS 정보 전달
    return true; // 비동기 응답을 위해 true 반환
  }

  // content.js에서 하이라이트 정보 요청 시 처리
  if (message.action === 'getHighlights') {
    // 현재 URL에 대한 하이라이트 정보 가져오기
    chrome.storage.local.get([message.url], (result) => {
      debugLog('Sending highlights for URL:', message.url, result[message.url] || []);
      sendResponse({ highlights: result[message.url] || [] });
    });
    return true; // 비동기 응답을 위해 true 반환
  }

  // content.js에서 하이라이트 정보 저장 요청 시 처리
  if (message.action === 'saveHighlights') {
    // 현재 URL에 대한 하이라이트 정보 저장
    // 페이지 제목도 함께 저장
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      const saveData = {};
      saveData[message.url] = message.highlights;

      // 메타데이터를 함께 저장 (하이라이트가 있을 경우에만)
      if (message.highlights.length > 0) {
        // 기존 메타데이터가 있는지 확인
        chrome.storage.local.get([`${message.url}_meta`], (result) => {
          const metaData = result[`${message.url}_meta`] || {};
          metaData.title = currentTab.title;
          metaData.lastUpdated = new Date().toISOString();

          const metaSaveData = {};
          metaSaveData[`${message.url}_meta`] = metaData;

          chrome.storage.local.set(metaSaveData, () => {
            debugLog('Saved page metadata:', metaData);
          });
        });
      } else {
        // 하이라이트가 없으면 메타데이터도 제거 (선택 사항)
        chrome.storage.local.remove([`${message.url}_meta`], () => {
          debugLog('Removed page metadata as no highlights remain:', message.url);
        });
      }

      debugLog('Saving highlights for URL:', message.url, message.highlights);
      chrome.storage.local.set(saveData, () => {
        sendResponse({ success: true });
      });
    });
    return true; // 비동기 응답을 위해 true 반환
  }
});
