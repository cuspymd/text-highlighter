// 현재 웹페이지의 하이라이트 데이터를 저장할 배열
let highlights = [];
const currentUrl = window.location.href;

// 디버그 모드 설정 - 개발 시 true로 변경 (background.js와 별개로 관리)
const DEBUG_MODE = false;

// 색상 정보 (background.js에서 메시지를 통해 받아옴)
let COLORS = [];

// 하이라이트 컨트롤러 UI 컨테이너
let highlightControlsContainer = null;
let activeHighlightElement = null;

// 디버그용 로그 함수
function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log(...args);
  }
}

// 페이지 로드 시 실행
debugLog('Content script loaded for:', currentUrl);

// Background Service Worker로부터 색상 정보를 가져옵니다.
getColorsFromBackground().then(() => {
  // 색상 정보를 받은 후에 하이라이트 로드 및 UI 생성
  loadHighlights();
  addHighlightStyles();
  createHighlightControls(); // 색상 정보 로드 후 UI 생성
}).catch(error => {
  console.error('Failed to load colors from background:', error);
  // 색상 정보 로드 실패 시 기본 UI만 생성하거나 오류 처리
  addHighlightStyles();
  createHighlightControls(); // 색상 정보 없이 기본 UI만 생성 시도
});


// 다른 영역 클릭 시 컨트롤러 숨기기 이벤트 리스너 추가
document.addEventListener('click', function (e) {
  if (!highlightControlsContainer) return;

  // 클릭한 요소가 하이라이트 요소나 컨트롤러가 아닌 경우에만 숨김
  const isClickOnHighlight = activeHighlightElement &&
    (activeHighlightElement.contains(e.target) || activeHighlightElement === e.target);
  const isClickOnControls = highlightControlsContainer.contains(e.target) ||
    highlightControlsContainer === e.target;

  if (!isClickOnHighlight && !isClickOnControls) {
    hideHighlightControls();
  }
});

// 백업으로 DOMContentLoaded 이벤트 리스너도 유지 (loadHighlights는 이미 getColorsFromBackground 후 호출됨)
document.addEventListener('DOMContentLoaded', () => {
  debugLog('DOMContentLoaded event fired');
  // loadHighlights(); // 이미 getColorsFromBackground 후 호출되므로 중복 호출 방지
});

// 백그라운드에서 메시지 수신 처리
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'highlight') {
    // 받은 색상 정보로 하이라이트 처리
    highlightSelectedText(message.color);
    sendResponse({ success: true });
  }
  else if (message.action === 'removeHighlight') {
    // 하이라이트 제거 처리
    removeHighlight();
    sendResponse({ success: true });
  }
  else if (message.action === 'refreshHighlights') {
    // 팝업에서 하이라이트 정보가 업데이트되었을 때 처리
    debugLog('Refreshing highlights:', message.highlights);
    highlights = message.highlights || [];
    clearAllHighlights();
    applyHighlights();
    sendResponse({ success: true });
    return true; // 비동기 응답을 위해 true 반환
  }
});

// Background Service Worker로부터 색상 정보를 비동기적으로 가져오는 함수
function getColorsFromBackground() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'getColors' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error getting colors:', chrome.runtime.lastError);
        return reject(chrome.runtime.lastError);
      }
      if (response && response.colors) {
        COLORS = response.colors;
        debugLog('Received colors from background:', COLORS);
        resolve();
      } else {
        reject('Invalid response from background for colors.');
      }
    });
  });
}


// 저장된 하이라이트 불러오기
function loadHighlights() {
  debugLog('Loading highlights for URL:', currentUrl);
  chrome.runtime.sendMessage(
    { action: 'getHighlights', url: currentUrl },
    (response) => {
      debugLog('Got highlights response:', response);
      if (response && response.highlights) {
        highlights = response.highlights;
        debugLog('Applying highlights:', highlights.length);
        applyHighlights();
      } else {
        debugLog('No highlights found or invalid response');
      }
    }
  );
}

// 하이라이트 저장하기
function saveHighlights() {
  chrome.runtime.sendMessage(
    {
      action: 'saveHighlights',
      url: currentUrl,
      highlights: highlights,
      timestamp: new Date().toISOString()
    },
    (response) => {
      debugLog('Highlights saved:', response?.success);
    }
  );
}

// 선택된 텍스트 하이라이트 처리
function highlightSelectedText(color) {
  const selection = window.getSelection();

  if (!selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  const selectionContents = range.extractContents();
  const span = document.createElement('span');

  span.appendChild(selectionContents);
  span.className = 'text-highlighter-extension';
  span.style.backgroundColor = color;

  // 고유 ID 생성 (간단하게 타임스탬프 사용)
  span.dataset.highlightId = Date.now().toString();

  range.insertNode(span);

  // 하이라이트 정보 저장
  highlights.push({
    id: span.dataset.highlightId,
    text: span.textContent,
    color: color,
    xpath: getXPathForElement(span),
    textRange: {
      startOffset: range.startOffset,
      endOffset: range.endOffset
    }
  });

  // 이벤트 리스너 추가
  addHighlightEventListeners(span);

  saveHighlights();
  selection.removeAllRanges();
}

// 하이라이트 제거
function removeHighlight(highlightElement = null) {
  if (!highlightElement) {
    // 선택된 텍스트가 있는 경우 (기존 방식 유지)
    const selection = window.getSelection();

    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    let node = range.commonAncestorContainer;

    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE &&
        node.classList.contains('text-highlighter-extension')) {
        highlightElement = node;
        break;
      }
      node = node.parentNode;
    }
  }

  if (highlightElement) {
    const parent = highlightElement.parentNode;
    while (highlightElement.firstChild) {
      parent.insertBefore(highlightElement.firstChild, highlightElement);
    }

    // highlights 배열에서 해당 항목 제거
    const highlightId = highlightElement.dataset.highlightId;
    highlights = highlights.filter(h => h.id !== highlightId);

    // 요소 제거 및 저장
    parent.removeChild(highlightElement);
    saveHighlights();

    // 활성화된 하이라이트 초기화 및 컨트롤러 숨기기
    if (activeHighlightElement === highlightElement) {
      activeHighlightElement = null;
      hideHighlightControls();
    }
  }
}

// 하이라이트 색상 변경
function changeHighlightColor(highlightElement, newColor) {
  if (!highlightElement) return;

  // 배경색만 설정
  highlightElement.style.backgroundColor = newColor;

  // highlights 배열에서 해당 항목 업데이트
  const highlightId = highlightElement.dataset.highlightId;
  const highlightIndex = highlights.findIndex(h => h.id === highlightId);

  if (highlightIndex !== -1) {
    highlights[highlightIndex].color = newColor;
    saveHighlights();
  }
}

// 페이지의 모든 하이라이트 제거
function clearAllHighlights() {
  debugLog('Clearing all highlights');
  const highlightElements = document.querySelectorAll('.text-highlighter-extension');
  highlightElements.forEach(element => {
    const parent = element.parentNode;
    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }
    parent.removeChild(element);
  });
}

// 저장된 하이라이트 정보로 페이지에 적용
function applyHighlights() {
  debugLog('Applying highlights, count:', highlights.length);
  highlights.forEach(highlight => {
    try {
      // 텍스트 기반 검색 시도
      debugLog('Applying highlight:', highlight.text);
      const textFound = highlightTextInDocument(
        document.body,
        highlight.text,
        highlight.color,
        highlight.id
      );

      if (!textFound) {
        debugLog('Text not found by content, trying XPath');
        // XPath 기반 찾기 시도
        const element = getElementByXPath(highlight.xpath);
        if (element) {
          const textNode = findTextNodeByContent(element, highlight.text);

          if (textNode) {
            const span = document.createElement('span');
            span.textContent = highlight.text;
            span.className = 'text-highlighter-extension';
            span.style.backgroundColor = highlight.color;
            span.dataset.highlightId = highlight.id;

            // 텍스트 노드를 하이라이트 요소로 대체
            textNode.parentNode.replaceChild(span, textNode);

            addHighlightEventListeners(span);

            debugLog('Highlight applied via XPath');
          }
        }
      }
    } catch (error) {
      debugLog('Error applying highlight:', error);
    }
  });
}

// 문서 내에서 텍스트를 찾아 하이라이트 적용
function highlightTextInDocument(element, text, color, id) {
  if (!text || text.length < 3) return false; // 너무 짧은 텍스트는 건너뛰기

  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function (node) {
        // 이미 하이라이트된 요소의 자식은 건너뛰기
        if (node.parentNode.className === 'text-highlighter-extension') {
          return NodeFilter.FILTER_REJECT;
        }
        // script, style 태그 내부는 건너뛰기
        if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.parentNode.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    },
    false
  );

  let found = false;
  let node;

  while ((node = walker.nextNode()) && !found) {
    const content = node.textContent;
    const index = content.indexOf(text);

    if (index >= 0) {
      // 텍스트 발견
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + text.length);

      const span = document.createElement('span');
      span.className = 'text-highlighter-extension';
      span.style.backgroundColor = color;
      span.dataset.highlightId = id;

      range.surroundContents(span);

      // 이벤트 리스너 추가
      addHighlightEventListeners(span);

      found = true;
      debugLog('Text found and highlighted:', text);

      // Walker를 무효화했으므로 루프 종료
      break;
    }
  }

  return found;
}

// 하이라이트된 텍스트 요소에 이벤트 리스너 추가
function addHighlightEventListeners(highlightElement) {
  // 클릭 이벤트 - 하이라이트 컨트롤러 표시를 위한 이벤트
  highlightElement.addEventListener('click', function (e) {
    // 이미 활성화된 같은 하이라이트 요소인 경우 토글
    if (activeHighlightElement === highlightElement &&
      highlightControlsContainer &&
      highlightControlsContainer.style.display !== 'none') {
      hideHighlightControls();
    } else {
      // 다른 하이라이트 컨트롤러가 활성화되어 있으면 먼저 숨김
      hideHighlightControls();

      // 현재 클릭한 하이라이트 활성화 및 컨트롤러 표시
      activeHighlightElement = highlightElement;
      showHighlightControls(highlightElement);

      // 이벤트 전파 중지 (문서 전체 클릭 이벤트에 영향을 주지 않도록)
      e.stopPropagation();
    }
  });
}

// 텍스트 내용으로 텍스트 노드 찾기
function findTextNodeByContent(element, text) {
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent.includes(text)) {
      return node;
    }
  }

  return null;
}

// XPath로 요소 가져오기
function getElementByXPath(xpath) {
  return document.evaluate(
    xpath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  ).singleNodeValue;
}

// 요소의 XPath 생성
function getXPathForElement(element) {
  if (element.tagName === 'HTML') {
    return '/HTML[1]';
  }
  if (element === document.body) {
    return '/HTML[1]/BODY[1]';
  }

  let ix = 0;
  const siblings = element.parentNode.childNodes;

  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];

    if (sibling === element) {
      const pathIndex = ix + 1;
      const path = getXPathForElement(element.parentNode) +
        '/' + element.tagName + '[' + pathIndex + ']';
      return path;
    }

    if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
      ix++;
    }
  }
}

// 하이라이트 컨트롤러 UI 생성
function createHighlightControls() {
  if (highlightControlsContainer) return;

  // 컨테이너 생성
  highlightControlsContainer = document.createElement('div');
  highlightControlsContainer.className = 'text-highlighter-controls';
  highlightControlsContainer.style.display = 'none';

  // 삭제 버튼 생성
  const deleteButton = document.createElement('div');
  deleteButton.className = 'text-highlighter-control-button delete-highlight';
  deleteButton.innerHTML = '×'; // 삭제 버튼 (X 표시)
  deleteButton.title = '하이라이트 삭제';
  deleteButton.addEventListener('click', function (e) {
    if (activeHighlightElement) {
      removeHighlight(activeHighlightElement);
    }
    // 이벤트 전파 중지 (문서 전체 클릭 이벤트에 영향을 주지 않도록)
    e.stopPropagation();
  });

  // 색상 버튼들 컨테이너
  const colorButtonsContainer = document.createElement('div');
  colorButtonsContainer.className = 'text-highlighter-color-buttons';

  // 색상 버튼 생성 (COLORS 변수 사용)
  COLORS.forEach(colorInfo => {
    const colorButton = document.createElement('div');
    colorButton.className = 'text-highlighter-control-button color-button';
    colorButton.style.backgroundColor = colorInfo.color;
    colorButton.title = colorInfo.name;

    // 색상 버튼 클릭 이벤트
    colorButton.addEventListener('click', function (e) {
      if (activeHighlightElement) {
        changeHighlightColor(activeHighlightElement, colorInfo.color);
      }
      // 이벤트 전파 중지 (문서 전체 클릭 이벤트에 영향을 주지 않도록)
      e.stopPropagation();
    });

    colorButtonsContainer.appendChild(colorButton);
  });

  // 버튼들을 컨테이너에 추가
  highlightControlsContainer.appendChild(deleteButton);
  highlightControlsContainer.appendChild(colorButtonsContainer);

  // 컨트롤러 클릭 이벤트 막기 - 컨트롤러 영역 클릭 시 닫히지 않도록
  highlightControlsContainer.addEventListener('click', function (e) {
    e.stopPropagation();
  });

  // 컨테이너를 body에 추가
  document.body.appendChild(highlightControlsContainer);
}

// 하이라이트 컨트롤러 UI 표시
function showHighlightControls(highlightElement) {
  if (!highlightControlsContainer) createHighlightControls();

  // 하이라이트의 첫 번째 텍스트 노드 시작 위치 찾기
  const firstTextPosition = getFirstTextNodePosition(highlightElement);
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

  // 컨트롤러 위치 설정 (하이라이트 첫 텍스트 노드 위에 위치)
  highlightControlsContainer.style.top = (firstTextPosition.top + scrollTop - 30) + 'px';
  highlightControlsContainer.style.left = (firstTextPosition.left + scrollLeft) + 'px';
  highlightControlsContainer.style.display = 'flex';
}

// 하이라이트 요소의 첫 번째 텍스트 노드 위치 구하기
function getFirstTextNodePosition(element) {
  // 첫 번째 텍스트 노드 찾기
  let firstTextNode = null;
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  firstTextNode = walker.nextNode();

  if (!firstTextNode && element.childNodes.length > 0) {
    // 직접적인 텍스트 노드가 없는 경우 첫 번째 자식 요소 사용
    return element.getBoundingClientRect();
  }

  if (firstTextNode) {
    // 첫 번째 텍스트 노드의 첫 글자 위치 계산
    const range = document.createRange();
    range.setStart(firstTextNode, 0);
    range.setEnd(firstTextNode, 1); // 첫 번째 글자만

    const rect = range.getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left
    };
  }

  // 폴백: 요소의 전체 영역 반환
  return element.getBoundingClientRect();
}

// 하이라이트 컨트롤러 UI 숨기기
function hideHighlightControls() {
  if (highlightControlsContainer) {
    highlightControlsContainer.style.display = 'none';
  }
  activeHighlightElement = null;
}

// 하이라이트 및 컨트롤러 스타일 추가
function addHighlightStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .text-highlighter-extension {
      position: relative;
      cursor: pointer;
      border-radius: 2px;
      padding: 0 1px;
    }
    
    .text-highlighter-controls {
      position: absolute;
      display: flex;
      align-items: center;
      z-index: 9999;
      background-color: #fff;
      border: 1px solid #ccc;
      border-radius: 15px;
      padding: 3px 6px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    }
    
    .text-highlighter-control-button {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 2px;
      cursor: pointer;
      user-select: none;
    }
    
    .delete-highlight {
      background-color: #ff4444;
      color: white;
      font-weight: bold;
      font-size: 16px;
    }
    
    .text-highlighter-color-buttons {
      display: flex;
      margin-left: 5px;
    }
    
    .color-button {
      border: 1px solid #ccc;
    }
    
    .color-button:hover, .delete-highlight:hover {
      transform: scale(1.1);
    }
  `;
  document.head.appendChild(style);
}
