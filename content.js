// 현재 웹페이지의 하이라이트 데이터를 저장할 배열
let highlights = [];
const currentUrl = window.location.href;

// 디버그 모드 설정 - 개발 시 true로 변경
const DEBUG_MODE = false;

// 색상 정보 (background.js의 COLORS와 일치해야 함)
const COLORS = [
  { id: 'yellow', name: '노란색', color: '#FFFF00' },
  { id: 'green', name: '초록색', color: '#AAFFAA' },
  { id: 'blue', name: '파란색', color: '#AAAAFF' },
  { id: 'pink', name: '분홍색', color: '#FFAAFF' },
  { id: 'orange', name: '주황색', color: '#FFAA55' }
];

// 하이라이트 컨트롤러 UI 컨테이너
let highlightControlsContainer = null;
let activeHighlightElement = null;

// 디버그용 로그 함수
function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log(...args);
  }
}

// 페이지 로드 시 저장된 하이라이트 정보 불러오기
debugLog('Content script loaded for:', currentUrl);
loadHighlights();

// 페이지에 스타일 추가
addHighlightStyles();

// 페이지에 하이라이트 컨트롤러 UI 추가
createHighlightControls();

// 백업으로 DOMContentLoaded 이벤트 리스너도 유지
document.addEventListener('DOMContentLoaded', () => {
  debugLog('DOMContentLoaded event fired');
  loadHighlights();
});

// 백그라운드에서 메시지 수신 처리
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'highlight') {
    highlightSelectedText(message.color);
    sendResponse({ success: true });
  }
  else if (message.action === 'removeHighlight') {
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
    return true;
  }
});

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

// 배경색의 밝기에 따라 적절한 텍스트 색상을 결정하는 함수
function getContrastTextColor(backgroundColor) {
  // 16진수 색상 코드를 RGB로 변환
  const hexToRgb = (hex) => {
    // 짧은 형식(#RGB)인 경우 전체 형식(#RRGGBB)으로 변환
    const fullHex = hex.length === 4 ?
      `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;

    const r = parseInt(fullHex.substring(1, 3), 16);
    const g = parseInt(fullHex.substring(3, 5), 16);
    const b = parseInt(fullHex.substring(5, 7), 16);
    return { r, g, b };
  };

  // RGB 색상의 밝기 계산 (YIQ 공식 사용)
  const getColorBrightness = (r, g, b) => {
    return (r * 299 + g * 587 + b * 114) / 1000;
  };

  let rgb;
  // RGB 형식 처리 (예: rgb(255, 255, 0))
  if (backgroundColor.startsWith('rgb')) {
    const match = backgroundColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      rgb = {
        r: parseInt(match[1], 10),
        g: parseInt(match[2], 10),
        b: parseInt(match[3], 10)
      };
    }
  } else {
    // 16진수 색상 코드 처리
    rgb = hexToRgb(backgroundColor);
  }

  if (!rgb) return '#000000'; // 기본값은 검은색

  const brightness = getColorBrightness(rgb.r, rgb.g, rgb.b);

  // 임계값(128)보다 밝으면 검은색, 어두우면 흰색 반환
  return brightness > 128 ? '#000000' : '#FFFFFF';
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

  // 배경색에 따라 적절한 텍스트 색상 설정
  span.style.color = getContrastTextColor(color);

  span.dataset.highlightId = Date.now().toString();

  range.insertNode(span);

  // 하이라이트 정보 저장
  highlights.push({
    id: span.dataset.highlightId,
    text: span.textContent,
    color: color,
    textColor: span.style.color, // 텍스트 색상도 저장
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
    // 선택된 텍스트가 있는 경우 (기존 방식)
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

  // 배경색 및 텍스트 색상 설정
  highlightElement.style.backgroundColor = newColor;
  const textColor = getContrastTextColor(newColor);
  highlightElement.style.color = textColor;

  // highlights 배열에서 해당 항목 업데이트
  const highlightId = highlightElement.dataset.highlightId;
  const highlightIndex = highlights.findIndex(h => h.id === highlightId);

  if (highlightIndex !== -1) {
    highlights[highlightIndex].color = newColor;
    highlights[highlightIndex].textColor = textColor;
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
        highlight.id,
        highlight.textColor // 저장된 텍스트 색상 전달
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

            // 저장된 텍스트 색상이 있으면 사용, 없으면 계산
            span.style.color = highlight.textColor || getContrastTextColor(highlight.color);

            span.dataset.highlightId = highlight.id;

            // 텍스트 노드를 하이라이트 요소로 대체
            textNode.parentNode.replaceChild(span, textNode);

            // 이벤트 리스너 추가
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
function highlightTextInDocument(element, text, color, id, textColor) {
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

      // 저장된 텍스트 색상이 있으면 사용, 없으면 계산
      span.style.color = textColor || getContrastTextColor(color);

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
  // 마우스 오버 이벤트
  highlightElement.addEventListener('mouseenter', function (e) {
    activeHighlightElement = highlightElement;
    showHighlightControls(highlightElement);
  });

  // 마우스 아웃 이벤트 (컨트롤러 영역으로 이동할 때는 사라지지 않도록)
  document.addEventListener('mouseover', function (e) {
    if (!highlightControlsContainer) return;

    // 마우스가 하이라이트 요소나 컨트롤러 위에 있는지 체크
    const isOverHighlight = highlightElement.contains(e.target) || highlightElement === e.target;
    const isOverControls = highlightControlsContainer.contains(e.target) || highlightControlsContainer === e.target;

    if (!isOverHighlight && !isOverControls) {
      hideHighlightControls();
    }
  });

  // 클릭 이벤트 (필요한 경우)
  highlightElement.addEventListener('click', function (e) {
    // 클릭 시 선택이 일어나지 않도록 함 (필요한 경우)
    // e.preventDefault();
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
  deleteButton.addEventListener('click', function () {
    if (activeHighlightElement) {
      removeHighlight(activeHighlightElement);
    }
  });

  // 색상 버튼들 컨테이너
  const colorButtonsContainer = document.createElement('div');
  colorButtonsContainer.className = 'text-highlighter-color-buttons';

  // 색상 버튼 생성
  COLORS.forEach(colorInfo => {
    const colorButton = document.createElement('div');
    colorButton.className = 'text-highlighter-control-button color-button';
    colorButton.style.backgroundColor = colorInfo.color;
    colorButton.title = colorInfo.name;

    // 색상 버튼 클릭 이벤트
    colorButton.addEventListener('click', function () {
      if (activeHighlightElement) {
        changeHighlightColor(activeHighlightElement, colorInfo.color);
      }
    });

    colorButtonsContainer.appendChild(colorButton);
  });

  // 버튼들을 컨테이너에 추가
  highlightControlsContainer.appendChild(deleteButton);
  highlightControlsContainer.appendChild(colorButtonsContainer);

  // 컨테이너를 body에 추가
  document.body.appendChild(highlightControlsContainer);
}

// 하이라이트 컨트롤러 UI 표시
function showHighlightControls(highlightElement) {
  if (!highlightControlsContainer) createHighlightControls();

  // 하이라이트 요소의 위치 계산
  const rect = highlightElement.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

  // 컨트롤러 위치 설정 (하이라이트 요소 위에 위치)
  highlightControlsContainer.style.top = (rect.top + scrollTop - 30) + 'px';
  highlightControlsContainer.style.left = (rect.left + scrollLeft) + 'px';
  highlightControlsContainer.style.display = 'flex';
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
