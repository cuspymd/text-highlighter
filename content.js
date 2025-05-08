// 현재 웹페이지의 하이라이트 데이터를 저장할 배열
let highlights = [];
const currentUrl = window.location.href;

// 페이지 로드 시 저장된 하이라이트 정보 불러오기
document.addEventListener('DOMContentLoaded', () => {
  loadHighlights();
});

// 백그라운드에서 메시지 수신 처리
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'highlight') {
    highlightSelectedText(message.color);
  }
  else if (message.action === 'removeHighlight') {
    removeHighlight();
  }
});

// 저장된 하이라이트 불러오기
function loadHighlights() {
  chrome.runtime.sendMessage(
    { action: 'getHighlights', url: currentUrl },
    (response) => {
      if (response && response.highlights) {
        highlights = response.highlights;
        applyHighlights();
      }
    }
  );
}

// 하이라이트 저장하기
function saveHighlights() {
  chrome.runtime.sendMessage(
    { action: 'saveHighlights', url: currentUrl, highlights: highlights },
    (response) => {
      console.log('Highlights saved:', response.success);
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
  
  saveHighlights();
  selection.removeAllRanges();
}

// 하이라이트 제거
function removeHighlight() {
  const selection = window.getSelection();
  
  if (!selection.rangeCount) return;
  
  const range = selection.getRangeAt(0);
  let highlightSpan = null;
  
  // 현재 선택된 텍스트가 하이라이트된 요소 내부인지 확인
  let node = range.commonAncestorContainer;
  
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE && 
        node.classList.contains('text-highlighter-extension')) {
      highlightSpan = node;
      break;
    }
    node = node.parentNode;
  }
  
  if (highlightSpan) {
    const parent = highlightSpan.parentNode;
    while (highlightSpan.firstChild) {
      parent.insertBefore(highlightSpan.firstChild, highlightSpan);
    }
    
    // highlights 배열에서 해당 항목 제거
    const highlightId = highlightSpan.dataset.highlightId;
    highlights = highlights.filter(h => h.id !== highlightId);
    
    // 요소 제거 및 저장
    parent.removeChild(highlightSpan);
    saveHighlights();
    selection.removeAllRanges();
  }
}

// 저장된 하이라이트 정보로 페이지에 적용
function applyHighlights() {
  highlights.forEach(highlight => {
    try {
      const element = getElementByXPath(highlight.xpath);
      if (element) {
        const range = document.createRange();
        const textNode = findTextNodeByContent(element, highlight.text);
        
        if (textNode) {
          const span = document.createElement('span');
          span.textContent = highlight.text;
          span.className = 'text-highlighter-extension';
          span.style.backgroundColor = highlight.color;
          span.dataset.highlightId = highlight.id;
          
          // 텍스트 노드를 하이라이트 요소로 대체
          textNode.parentNode.replaceChild(span, textNode);
        }
      }
    } catch (error) {
      console.error('Error applying highlight:', error);
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
