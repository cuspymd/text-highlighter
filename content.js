let highlights = [];
const currentUrl = window.location.href;

const DEBUG_MODE = false;

let COLORS = [];

// 하이라이트 컨트롤러 UI 컨테이너
let highlightControlsContainer = null;
let activeHighlightElement = null;


// 미니맵 관련 변수 선언
let minimapContainer = null;
let minimapMarkers = [];
let resizeObserver = null;
let throttleTimer = null;

let minimapVisible = true;
let minimapToggleButton = null;

function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log(...args);
  }
}

debugLog('Content script loaded for:', currentUrl);

getColorsFromBackground().then(() => {
  loadHighlights();
  createHighlightControls();
}).catch(error => {
  console.error('Failed to load colors from background:', error);
  createHighlightControls();
});

// 다른 영역 클릭 시 컨트롤러 숨기기 이벤트 리스너 추가
document.addEventListener('click', function (e) {
  if (!highlightControlsContainer) return;

  const isClickOnHighlight = activeHighlightElement &&
    (activeHighlightElement.contains(e.target) || activeHighlightElement === e.target);
  const isClickOnControls = highlightControlsContainer.contains(e.target) ||
    highlightControlsContainer === e.target;

  if (!isClickOnHighlight && !isClickOnControls) {
    hideHighlightControls();
  }
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
    debugLog('Refreshing highlights:', message.highlights);
    highlights = message.highlights || [];
    clearAllHighlights();
    applyHighlights();
    sendResponse({ success: true });
    return true;
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

      initMinimap();
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

  // 고유 ID 생성
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

  addHighlightEventListeners(span);

  saveHighlights();
  updateMinimapMarkers();

  selection.removeAllRanges();
}

// 하이라이트 제거
function removeHighlight(highlightElement = null) {
  if (!highlightElement) {
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

    parent.removeChild(highlightElement);
    saveHighlights();
    updateMinimapMarkers();

    if (activeHighlightElement === highlightElement) {
      activeHighlightElement = null;
      hideHighlightControls();
    }
  }
}

// 하이라이트 색상 변경
function changeHighlightColor(highlightElement, newColor) {
  if (!highlightElement) return;

  highlightElement.style.backgroundColor = newColor;

  const highlightId = highlightElement.dataset.highlightId;
  const highlightIndex = highlights.findIndex(h => h.id === highlightId);

  if (highlightIndex !== -1) {
    highlights[highlightIndex].color = newColor;
    saveHighlights();
    updateMinimapMarkers();
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

  updateMinimapMarkers();
}

// 문서 내에서 텍스트를 찾아 하이라이트 적용
function highlightTextInDocument(element, text, color, id) {
  if (!text || text.length < 3) return false; // 너무 짧은 텍스트는 건너뛰기

  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function (node) {
        if (node.parentNode.className === 'text-highlighter-extension') {
          return NodeFilter.FILTER_REJECT;
        }
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
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + text.length);

      const span = document.createElement('span');
      span.className = 'text-highlighter-extension';
      span.style.backgroundColor = color;
      span.dataset.highlightId = id;

      range.surroundContents(span);

      addHighlightEventListeners(span);

      found = true;
      debugLog('Text found and highlighted:', text);

      break;
    }
  }

  return found;
}

// 하이라이트된 텍스트 요소에 이벤트 리스너 추가
function addHighlightEventListeners(highlightElement) {
  highlightElement.addEventListener('click', function (e) {
    if (activeHighlightElement === highlightElement &&
      highlightControlsContainer &&
      highlightControlsContainer.style.display !== 'none') {
      hideHighlightControls();
    } else {
      hideHighlightControls();

      activeHighlightElement = highlightElement;
      showHighlightControls(highlightElement);

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

  highlightControlsContainer = document.createElement('div');
  highlightControlsContainer.className = 'text-highlighter-controls';
  highlightControlsContainer.style.display = 'none';

  // 삭제 버튼 생성
  const deleteButton = document.createElement('div');
  deleteButton.className = 'text-highlighter-control-button delete-highlight';
  deleteButton.innerHTML = '×';
  deleteButton.title = '하이라이트 삭제';
  deleteButton.addEventListener('click', function (e) {
    if (activeHighlightElement) {
      removeHighlight(activeHighlightElement);
    }
    e.stopPropagation();
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

    colorButton.addEventListener('click', function (e) {
      if (activeHighlightElement) {
        changeHighlightColor(activeHighlightElement, colorInfo.color);
      }
      e.stopPropagation();
    });

    colorButtonsContainer.appendChild(colorButton);
  });

  highlightControlsContainer.appendChild(deleteButton);
  highlightControlsContainer.appendChild(colorButtonsContainer);

  highlightControlsContainer.addEventListener('click', function (e) {
    e.stopPropagation();
  });

  document.body.appendChild(highlightControlsContainer);
}

// 하이라이트 컨트롤러 UI 표시
function showHighlightControls(highlightElement) {
  if (!highlightControlsContainer) createHighlightControls();

  const firstTextPosition = getFirstTextNodePosition(highlightElement);
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

  highlightControlsContainer.style.top = (firstTextPosition.top + scrollTop - 30) + 'px';
  highlightControlsContainer.style.left = (firstTextPosition.left + scrollLeft) + 'px';
  highlightControlsContainer.style.display = 'flex';
}

// 하이라이트 요소의 첫 번째 텍스트 노드 위치 구하기
function getFirstTextNodePosition(element) {
  let firstTextNode = null;
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  firstTextNode = walker.nextNode();

  if (!firstTextNode && element.childNodes.length > 0) {
    return element.getBoundingClientRect();
  }

  if (firstTextNode) {
    const range = document.createRange();
    range.setStart(firstTextNode, 0);
    range.setEnd(firstTextNode, 1);

    const rect = range.getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left
    };
  }

  return element.getBoundingClientRect();
}

// 하이라이트 컨트롤러 UI 숨기기
function hideHighlightControls() {
  if (highlightControlsContainer) {
    highlightControlsContainer.style.display = 'none';
  }
  activeHighlightElement = null;
}

// 미니맵 초기화 함수
function initMinimap() {
  // 이미 존재하면 초기화하지 않음
  if (minimapContainer) return;

  // 미니맵 컨테이너 생성
  minimapContainer = document.createElement('div');
  minimapContainer.className = 'text-highlighter-minimap';

  // 미니맵이 하이라이트 컨트롤러보다 우선순위가 낮도록 설정
  minimapContainer.style.pointerEvents = 'none';

  document.body.appendChild(minimapContainer);
  createMinimapToggleButton();

  // ResizeObserver를 사용하여 페이지 크기 변경 시 미니맵 마커 위치 업데이트
  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(throttle(() => {
      updateMinimapMarkers();
    }, 100));

    resizeObserver.observe(document.body);
  }

  // 스크롤 이벤트 리스너 추가
  window.addEventListener('scroll', throttle(() => {
    updateMinimapMarkerVisibility();
  }, 100));
}

// 미니맵 마커 업데이트 함수
function updateMinimapMarkers() {
  if (!minimapContainer) return;

  // 기존 마커 제거
  while (minimapContainer.firstChild) {
    minimapContainer.removeChild(minimapContainer.firstChild);
  }
  minimapMarkers = [];

  const highlightElements = document.querySelectorAll('.text-highlighter-extension');
  const documentHeight = Math.max(
    document.body.scrollHeight,
    document.body.offsetHeight,
    document.documentElement.clientHeight,
    document.documentElement.scrollHeight,
    document.documentElement.offsetHeight
  );

  const minimapHeight = minimapContainer.clientHeight;

  if (highlightElements.length === 0) {
    // 하이라이트가 없으면 미니맵 숨기기
    minimapContainer.style.display = 'none';
    minimapToggleButton.style.display = 'none';
    return;
  } else {
    // 하이라이트가 있으면 미니맵 표시
    minimapContainer.style.display = 'flex';
    minimapContainer.style.pointerEvents = 'auto'; // 클릭 가능하도록 설정
    minimapToggleButton.style.display = 'flex';
  }

  highlightElements.forEach(element => {
    const rect = element.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const absoluteTop = rect.top + scrollTop;

    // 위치 비율 계산
    const relativePosition = absoluteTop / documentHeight;
    const markerPosition = relativePosition * minimapHeight;

    // 마커 요소 생성
    const marker = document.createElement('div');
    marker.className = 'text-highlighter-minimap-marker';

    marker.style.backgroundColor = element.style.backgroundColor;
    marker.style.top = `${markerPosition}px`;

    // 하이라이트 ID를 마커에 저장
    marker.dataset.highlightId = element.dataset.highlightId;

    // 마커 클릭 이벤트
    marker.addEventListener('click', (e) => {
      e.stopPropagation();

      // 해당 하이라이트로 스크롤
      scrollToHighlight(element);

      // 해당 하이라이트 잠시 강조 효과
      highlightTemporarily(element);
    });

    minimapContainer.appendChild(marker);
    minimapMarkers.push({
      element: marker,
      highlightElement: element,
      position: absoluteTop
    });
  });

  updateMinimapMarkerVisibility();
}

// 미니맵 마커 가시성 업데이트 (현재 화면에 보이는 하이라이트 표시)
function updateMinimapMarkerVisibility() {
  if (!minimapContainer || minimapMarkers.length === 0) return;

  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const windowHeight = window.innerHeight;
  const visibleRange = {
    top: scrollTop,
    bottom: scrollTop + windowHeight
  };

  minimapMarkers.forEach(marker => {
    const highlightRect = marker.highlightElement.getBoundingClientRect();
    const highlightAbsoluteTop = highlightRect.top + scrollTop;
    const highlightAbsoluteBottom = highlightRect.bottom + scrollTop;

    // 현재 화면에 보이는지 확인
    const isVisible = (
      (highlightAbsoluteTop >= visibleRange.top && highlightAbsoluteTop <= visibleRange.bottom) ||
      (highlightAbsoluteBottom >= visibleRange.top && highlightAbsoluteBottom <= visibleRange.bottom) ||
      (highlightAbsoluteTop <= visibleRange.top && highlightAbsoluteBottom >= visibleRange.bottom)
    );

    // 현재 화면에 보이는 하이라이트는 마커에 테두리 효과
    if (isVisible) {
      marker.element.style.border = '2px solid white';
    } else {
      marker.element.style.border = 'none';
    }
  });
}

// 하이라이트로 스크롤 함수
function scrollToHighlight(highlightElement) {
  if (!highlightElement) return;

  const rect = highlightElement.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const absoluteTop = rect.top + scrollTop;

  // 스크롤 위치 조정 (약간 위에 위치하도록)
  const scrollToPosition = absoluteTop - 100;

  // 부드러운 스크롤
  window.scrollTo({
    top: scrollToPosition,
    behavior: 'smooth'
  });
}

// 하이라이트 일시적 강조 효과
function highlightTemporarily(highlightElement) {
  if (!highlightElement) return;

  // 원래 스타일 저장
  const originalBoxShadow = highlightElement.style.boxShadow;
  const originalTransition = highlightElement.style.transition;

  // 강조 스타일 적용
  highlightElement.style.boxShadow = '0 0 0 3px rgba(255, 255, 255, 0.7), 0 0 0 6px rgba(0, 0, 0, 0.3)';
  highlightElement.style.transition = 'box-shadow 0.3s';

  // 일정 시간 후 원래 스타일로 복원
  setTimeout(() => {
    highlightElement.style.boxShadow = originalBoxShadow;
    highlightElement.style.transition = originalTransition;
  }, 1500);
}

// 쓰로틀링 헬퍼 함수 (성능 최적화용)
function throttle(callback, delay) {
  return function () {
    if (throttleTimer) return;

    throttleTimer = setTimeout(() => {
      callback.apply(this, arguments);
      throttleTimer = null;
    }, delay);
  };
}

// 창 크기 변경 이벤트 리스너 추가 (파일 끝에 추가)
window.addEventListener('resize', throttle(() => {
  if (minimapContainer) {
    updateMinimapMarkers();
  }
}, 200));

function createMinimapToggleButton() {
  if (minimapToggleButton) return;

  // 토글 버튼 생성
  minimapToggleButton = document.createElement('div');
  minimapToggleButton.className = 'text-highlighter-minimap-toggle';
  minimapToggleButton.innerHTML = 'M'; // 'M'은 Minimap의 약자
  minimapToggleButton.title = '미니맵 표시/숨기기';

  // 토글 기능 추가
  minimapToggleButton.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMinimapVisibility();
  });

  document.body.appendChild(minimapToggleButton);
}

// 미니맵 토글 함수
function toggleMinimapVisibility() {
  minimapVisible = !minimapVisible;

  if (minimapContainer) {
    if (minimapVisible) {
      minimapContainer.style.display = 'flex';
      minimapToggleButton.innerHTML = 'M';
      minimapToggleButton.title = '미니맵 숨기기';
    } else {
      minimapContainer.style.display = 'none';
      minimapToggleButton.innerHTML = 'M';
      minimapToggleButton.title = '미니맵 표시하기';
    }
  }
}

