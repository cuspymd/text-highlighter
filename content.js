let highlights = [];
const currentUrl = window.location.href;

const DEBUG_MODE = true;

let currentColors = [];

// Highlight controller UI container
let highlightControlsContainer = null;
let activeHighlightElement = null;
// Flag to know when the native <input type="color"> picker is open
let colorPickerOpen = false;

// Minimap manager instance
let minimapManager = null;

function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log(...args);
  }
}

// i18n support function
function getMessage(key, substitutions = null) {
  return chrome.i18n.getMessage(key, substitutions);
}

debugLog('Content script loaded for:', currentUrl);

getColorsFromBackground().then(() => {
  setTimeout(() => {
    loadHighlights();
    createHighlightControls();
  }, 500);
}).catch(error => {
  console.error('Failed to load colors from background:', error);
  createHighlightControls();
});

// Add event listener to hide controller when clicking other areas
document.addEventListener('click', function (e) {
  if (!highlightControlsContainer) return;
  // While native color picker is open, keep the control UI visible
  if (colorPickerOpen) {
    colorPickerOpen = false;
    return; 
  } else {
    colorPickerOpen = false;
  }

  const isClickOnHighlight = activeHighlightElement &&
    (activeHighlightElement.contains(e.target) || activeHighlightElement === e.target);
  const isClickOnControls = highlightControlsContainer.contains(e.target) ||
    highlightControlsContainer === e.target;

  if (!isClickOnHighlight && !isClickOnControls) {
    hideHighlightControls();
  }
});

// Handle messages received from background
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
  else if (message.action === 'colorsUpdated') {
    currentColors = message.colors || currentColors;
    refreshHighlightControlsColors();
    sendResponse({ success: true });
    return true;
  }
  else if (message.action === 'setMinimapVisibility') {
    if (minimapManager) {
      minimapManager.setVisibility(message.visible);
    }
    sendResponse({ success: true });
    return true;
  }
});

// Function to asynchronously get color information from Background Service Worker
function getColorsFromBackground() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'getColors' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error getting colors:', chrome.runtime.lastError);
        return reject(chrome.runtime.lastError);
      }
      if (response && response.colors) {
        currentColors = response.colors;
        debugLog('Received colors from background:', currentColors);
        resolve();
      } else {
        reject('Invalid response from background for colors.');
      }
    });
  });
}

function loadHighlights() {
  debugLog('Loading highlights for URL:', currentUrl);

  chrome.runtime.sendMessage(
    { action: 'getHighlights', url: currentUrl },
    (response) => {
      debugLog('Got highlights response:', response);
      if (response && response.highlights) {
        highlights = response.highlights;
        applyHighlights();
      } else {
        debugLog('No highlights found or invalid response');
      }

      initMinimap();
    }
  );
}

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

function removeHighlight(highlightElement = null) {
  if (!highlightElement) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    let node = range.commonAncestorContainer;
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('text-highlighter-extension')) {
        highlightElement = node;
        break;
      }
      node = node.parentNode;
    }
  }
  if (highlightElement) {
    const groupId = highlightElement.dataset.groupId;
    // 그룹 내 모든 span 삭제
    const groupSpans = document.querySelectorAll(`.text-highlighter-extension[data-group-id='${groupId}']`);
    groupSpans.forEach(span => {
      const parent = span.parentNode;
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
    });
    // highlights 배열에서 그룹 삭제
    highlights = highlights.filter(g => g.groupId !== groupId);
    saveHighlights();
    updateMinimapMarkers();
    if (activeHighlightElement && activeHighlightElement.dataset.groupId === groupId) {
      activeHighlightElement = null;
      hideHighlightControls();
    }
  }
}

function changeHighlightColor(highlightElement, newColor) {
  if (!highlightElement) return;
  const groupId = highlightElement.dataset.groupId;
  // DOM의 모든 span 색상 변경
  const groupSpans = document.querySelectorAll(`.text-highlighter-extension[data-group-id='${groupId}']`);
  groupSpans.forEach(span => {
    span.style.backgroundColor = newColor;
  });
  // highlights 배열에서 색상 변경
  const group = highlights.find(g => g.groupId === groupId);
  if (group) {
    group.color = newColor;
    saveHighlights();
    updateMinimapMarkers();
  }
}

// Remove all highlights from the page
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

// Apply highlights to the page using saved highlight information
function applyHighlights() {
  debugLog('Applying highlights, count:', highlights.length);
  highlights.forEach(group => {
    try {
      debugLog('Applying highlight group:', group);
      highlightTextInDocument(
        document.body,
        group.spans,
        group.color,
        group.groupId
      );
    } catch (error) {
      debugLog('Error applying highlight group:', error);
    }
  });
  updateMinimapMarkers();
}

// Find text in document and apply highlight for a group of spans
function highlightTextInDocument(element, spanInfos, color, groupId) {
  if (!spanInfos || spanInfos.length === 0) return false;

  // 1. 텍스트 노드 수집
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function (node) {
        if (!node.nodeValue || node.nodeValue.trim() === '') {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.classList && parent.classList.contains('text-highlighter-extension')) {
          return NodeFilter.FILTER_REJECT;
        }
        const parentTagName = parent.tagName && parent.tagName.toUpperCase();
        if ([
          'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'
        ].includes(parentTagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        let el = parent;
        while (el && el !== document.body && el !== document.documentElement) {
          if (window.getComputedStyle(el).display === 'none') {
            return NodeFilter.FILTER_REJECT;
          }
          el = el.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    },
    false
  );
  const textNodes = [];
  let currentNode;
  while (currentNode = walker.nextNode()) {
    textNodes.push(currentNode);
  }
  if (textNodes.length === 0) {
    debugLog('No suitable text nodes found for group:', groupId);
    return false;
  }

  // 2. 첫 span: position 기준으로 후보 중 가장 가까운 것 선택
  const firstSpan = spanInfos[0];
  const firstText = firstSpan.text;
  const firstPosition = firstSpan.position;
  const candidates = [];
  for (let i = 0; i < textNodes.length; i++) {
    const node = textNodes[i];
    const nodeText = node.textContent;
    const searchText = firstText;
    const idx = nodeText.indexOf(searchText);
    if (idx !== -1) {
      let range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + searchText.length);
      const rect = range.getBoundingClientRect();
      const top = rect.top + (window.scrollY || document.documentElement.scrollTop);
      candidates.push({ node, idx, top });
    }
  }
  if (candidates.length === 0) {
    debugLog('First span text not found:', firstText);
    return false;
  }
  // position과 가장 가까운 후보 선택
  let bestCandidate = candidates[0];
  if (typeof firstPosition === 'number') {
    let minDiff = Math.abs(candidates[0].top - firstPosition);
    for (let i = 1; i < candidates.length; i++) {
      const diff = Math.abs(candidates[i].top - firstPosition);
      if (diff < minDiff) {
        minDiff = diff;
        bestCandidate = candidates[i];
      }
    }
  }
  // 3. 첫 span 하이라이트 적용
  let currentNodeIdx = textNodes.indexOf(bestCandidate.node);
  let currentCharIdx = bestCandidate.idx;
  let highlightSpans = [];
  for (let s = 0; s < spanInfos.length; s++) {
    const spanInfo = spanInfos[s];
    const spanText = spanInfo.text;
    let found = false;
    // 이후 span은 순차적으로 텍스트 노드에서만 매칭
    for (; currentNodeIdx < textNodes.length; currentNodeIdx++) {
      const node = textNodes[currentNodeIdx];
      const nodeText = node.textContent;
      let searchStart = (s === 0) ? currentCharIdx : 0;
      const idx = nodeText.indexOf(spanText, searchStart);
      if (idx !== -1) {
        let range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + spanText.length);
        // 하이라이트 적용
        const span = document.createElement('span');
        span.className = 'text-highlighter-extension';
        span.style.backgroundColor = color;
        if (groupId) span.dataset.groupId = groupId;
        if (spanInfo.spanId) span.dataset.spanId = spanInfo.spanId;
        try {
          const contents = range.extractContents();
          span.appendChild(contents);
          range.insertNode(span);
          addHighlightEventListeners(span);
          highlightSpans.push(span);
        } catch (e) {
          debugLog('Error creating highlight (single node):', e, 'Search:', spanText, 'Range text:', range.toString());
        }
        // 다음 span은 이 노드 이후부터 검색
        currentCharIdx = idx + spanText.length;
        found = true;
        break;
      } else {
        currentCharIdx = 0;
      }
    }
    if (!found) {
      debugLog('Span text not found in sequence:', spanText);
      return false;
    }
  }
  return highlightSpans;
}

// Add event listeners to highlighted text elements
function addHighlightEventListeners(highlightElement) {
  highlightElement.addEventListener('click', function (e) {
    if (activeHighlightElement === highlightElement &&
      highlightControlsContainer &&
      highlightControlsContainer.style.display !== 'none') {
      hideHighlightControls();
    } else {
      hideHighlightControls();

      activeHighlightElement = highlightElement;
      showControlUi(highlightElement, e);

      e.stopPropagation();
    }
  });

  // 그룹 전체에 hover 효과
  highlightElement.addEventListener('mouseenter', function () {
    const groupId = highlightElement.dataset.groupId;
    if (!groupId) return;
    const groupSpans = document.querySelectorAll(`.text-highlighter-extension[data-group-id='${groupId}']`);
    groupSpans.forEach(span => {
      span.classList.add('group-hover');
    });
  });
  highlightElement.addEventListener('mouseleave', function () {
    const groupId = highlightElement.dataset.groupId;
    if (!groupId) return;
    const groupSpans = document.querySelectorAll(`.text-highlighter-extension[data-group-id='${groupId}']`);
    groupSpans.forEach(span => {
      span.classList.remove('group-hover');
    });
  });
}

// Find text node by content
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

// Create highlight controller UI
function createHighlightControls() {
  if (highlightControlsContainer) return;
  highlightControlsContainer = document.createElement('div');
  highlightControlsContainer.className = 'text-highlighter-controls';
  highlightControlsContainer.style.display = 'none';
  const deleteButton = document.createElement('div');
  deleteButton.className = 'text-highlighter-control-button delete-highlight';
  deleteButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><line x1="4" y1="4" x2="12" y2="12" stroke="white" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="4" x2="4" y2="12" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`;
  deleteButton.title = getMessage('deleteHighlight');
  deleteButton.addEventListener('click', function (e) {
    if (activeHighlightElement) {
      removeHighlight(activeHighlightElement);
    }
    e.stopPropagation();
  });
  const colorButtonsContainer = document.createElement('div');
  colorButtonsContainer.className = 'text-highlighter-color-buttons';
  currentColors.forEach((colorInfo, idx) => {
    // Insert a separator after the 5 default colors (only if custom colors exist)
    if (idx === 5 && currentColors.length > 5) {
      appendColorSeparator(colorButtonsContainer);
    }
    const colorButton = document.createElement('div');
    colorButton.className = 'text-highlighter-control-button color-button';
    colorButton.style.backgroundColor = colorInfo.color;
    colorButton.title = getMessage(colorInfo.nameKey);
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
  // --- 젤리 애니메이션 효과: 클릭 시 트리거 ---
  const addJellyAnimation = (btn) => {
    btn.addEventListener('click', function () {
      btn.classList.remove('jelly-animate'); // 중복 방지
      // 강제로 reflow를 발생시켜 애니메이션 재적용
      void btn.offsetWidth;
      btn.classList.add('jelly-animate');
    });
    btn.addEventListener('animationend', function (e) {
      if (e.animationName === 'jelly-bounce') {
        btn.classList.remove('jelly-animate');
      }
    });
  };
  // color 버튼들만 젤리 애니메이션 적용
  colorButtonsContainer.querySelectorAll('.text-highlighter-control-button').forEach(addJellyAnimation);

  // -------------- '+' button (add new color) --------------
  const addColorBtn = document.createElement('div');
  addColorBtn.className = 'text-highlighter-control-button add-color-button';
  addColorBtn.textContent = '+';
  addColorBtn.title = getMessage('addColor') || '+';
  addColorBtn.style.display = 'flex';
  addColorBtn.style.alignItems = 'center';
  addColorBtn.style.justifyContent = 'center';

  const hiddenColorInput = document.createElement('input');
  hiddenColorInput.type = 'color';
  hiddenColorInput.style.opacity = '0';
  hiddenColorInput.style.cursor = 'pointer';
  hiddenColorInput.style.position = 'absolute';
  hiddenColorInput.style.top = '0';
  hiddenColorInput.style.left = '0';
  hiddenColorInput.style.width = '100%';
  hiddenColorInput.style.height = '100%';

  // --- manage color picker open/close state ---
  hiddenColorInput.addEventListener('click', () => {
    colorPickerOpen = true;
  });

  // change 이벤트에서 실제 색상 추가 처리
  hiddenColorInput.addEventListener('change', (e) => {
    const newColor = e.target.value;
    if (!newColor) return;
    chrome.runtime.sendMessage({ action: 'addColor', color: newColor }, (response) => {
      if (response && response.colors) {
        currentColors = response.colors;
        refreshHighlightControlsColors();
      }
    });
  });

  // addColorBtn 내부에 input을 넣어 오버레이되도록 함
  addColorBtn.style.position = 'relative';
  addColorBtn.appendChild(hiddenColorInput);

  colorButtonsContainer.appendChild(addColorBtn);
  document.body.appendChild(highlightControlsContainer);
}

function appendColorSeparator(container) {
  const separator = document.createElement('div');
  separator.className = 'color-separator';
  separator.style.width = '1px';
  separator.style.height = '22px'; 
  separator.style.backgroundColor = '#ccc'; 
  separator.style.margin = '0 3px';
  container.appendChild(separator);
}

// -------- Helper: regenerate color buttons inside a container --------
function refreshHighlightControlsColors() {
  if (!highlightControlsContainer) return;
  const colorButtonsContainer = highlightControlsContainer.querySelector('.text-highlighter-color-buttons');
  if (!colorButtonsContainer) return;

  // Clear existing buttons
  colorButtonsContainer.innerHTML = '';

  // Helper to add jelly animation
  const addJellyAnimation = (btn) => {
    btn.addEventListener('click', function () {
      btn.classList.remove('jelly-animate');
      void btn.offsetWidth;
      btn.classList.add('jelly-animate');
    });
    btn.addEventListener('animationend', function (e) {
      if (e.animationName === 'jelly-bounce') {
        btn.classList.remove('jelly-animate');
      }
    });
  };

  // Re-create color buttons
  currentColors.forEach((colorInfo, idx) => {
    if (idx === 5 && currentColors.length > 5) {
      appendColorSeparator(colorButtonsContainer);
    }
    const colorButton = document.createElement('div');
    colorButton.className = 'text-highlighter-control-button color-button';
    colorButton.style.backgroundColor = colorInfo.color;
    colorButton.title = getMessage(colorInfo.nameKey);
    colorButton.addEventListener('click', function (e) {
      if (activeHighlightElement) {
        changeHighlightColor(activeHighlightElement, colorInfo.color);
      }
      e.stopPropagation();
    });
    addJellyAnimation(colorButton);
    colorButtonsContainer.appendChild(colorButton);
  });

  // Recreate + button
  const addColorBtn = document.createElement('div');
  addColorBtn.className = 'text-highlighter-control-button add-color-button';
  addColorBtn.textContent = '+';
  addColorBtn.title = getMessage('addColor') || '+';
  addColorBtn.style.display = 'flex';
  addColorBtn.style.alignItems = 'center';
  addColorBtn.style.justifyContent = 'center';
  addColorBtn.style.position = 'relative';

  const hiddenColorInput = document.createElement('input');
  hiddenColorInput.type = 'color';
  hiddenColorInput.style.opacity = '0';
  hiddenColorInput.style.cursor = 'pointer';
  hiddenColorInput.style.position = 'absolute';
  hiddenColorInput.style.top = '0';
  hiddenColorInput.style.left = '0';
  hiddenColorInput.style.width = '100%';
  hiddenColorInput.style.height = '100%';

  // reuse existing picker logic
  hiddenColorInput.addEventListener('click', () => { colorPickerOpen = true; });
  hiddenColorInput.addEventListener('change', (e) => {
    const newColor = e.target.value;
    if (!newColor) return;
    chrome.runtime.sendMessage({ action: 'addColor', color: newColor });
  });

  addColorBtn.appendChild(hiddenColorInput);
  colorButtonsContainer.appendChild(addColorBtn);
}

// Display highlight controller UI
function showControlUi(highlightElement, e) {
  if (!highlightControlsContainer) createHighlightControls();

  highlightControlsContainer.style.top = `${window.scrollY + e.clientY - 40}px`;
  highlightControlsContainer.style.left = `${window.scrollX + e.clientX - 40}px`;
  highlightControlsContainer.style.display = 'flex';
  // pop 애니메이션이 항상 재생되도록 visible 클래스를 remove/add
  highlightControlsContainer.classList.remove('visible');
  void highlightControlsContainer.offsetWidth; // reflow로 강제 초기화
  setTimeout(() => {
    highlightControlsContainer.classList.add('visible');
  }, 10);
}


// Get position of the first text node in highlight element
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

// Hide highlight controller UI
function hideHighlightControls() {
  if (highlightControlsContainer) {
    highlightControlsContainer.classList.remove('visible');
    // 트랜지션이 끝난 뒤 display를 none으로 변경
    setTimeout(() => {
      if (!highlightControlsContainer.classList.contains('visible')) {
        highlightControlsContainer.style.display = 'none';
      }
    }, 350); // CSS 트랜지션과 동일하게 맞춤
  }
  activeHighlightElement = null;
}

function initMinimap() {
  chrome.storage.local.get(['minimapVisible'], (result) => {
    const minimapVisible = result.minimapVisible !== undefined ? result.minimapVisible : true;

    minimapManager = new MinimapManager();
    minimapManager.setVisibility(minimapVisible);
    minimapManager.init();

    minimapManager.updateMarkers();

    debugLog('Minimap initialized with visibility:', minimapVisible);
  });
}

function updateMinimapMarkers() {
  if (minimapManager) {
    minimapManager.updateMarkers();
  }
}

// Refactored highlightSelectedText function with tree traversal algorithm
function highlightSelectedText(color) {
  const selection = window.getSelection();
  const selectedText = selection.toString();
  if (selectedText.trim() === '') return;

  const range = selection.getRangeAt(0);
  debugLog('Highlight Range:', {
    commonAncestorContainer: range.commonAncestorContainer,
    startContainer: range.startContainer,
    endContainer: range.endContainer,
    startOffset: range.startOffset,
    endOffset: range.endOffset
  });

  try {
    const groupId = Date.now().toString();
    const highlightSpans = processSelectionRange(range, color, groupId);
    if (highlightSpans.length > 0) {
      // 그룹 정보 생성
      const group = {
        groupId,
        color,
        text: selectedText,
        spans: []
      };
      highlightSpans.forEach((span, index) => {
        const rect = span.getBoundingClientRect();
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const spanId = `${groupId}_${index}`;
        span.dataset.groupId = groupId;
        span.dataset.spanId = spanId;
        group.spans.push({
          spanId,
          text: span.textContent,
          position: rect.top + scrollTop
        });
        addHighlightEventListeners(span);
      });
      highlights.push(group);
      saveHighlights();
      updateMinimapMarkers();
    }
  } catch (error) {
    debugLog('Error highlighting selected text:', error);
  }
  selection.removeAllRanges();
}

/**
 * Process selection range using tree traversal algorithm
 * @param {Range} range - The selection range
 * @param {string} color - Highlight color
 * @param {string} groupId - Base group ID
 * @returns {Array} Array of created highlight spans
 */
function processSelectionRange(range, color, groupId) {
  const commonAncestor = range.commonAncestorContainer;
  const startContainer = range.startContainer;
  const endContainer = range.endContainer;
  const startOffset = range.startOffset;
  const endOffset = range.endOffset;
  
  const highlightSpans = [];
  let currentSpan = null;
  let processingStarted = false;
  let spanCounter = 0;
  
  // Helper function to create a new span
  function createNewSpan() {
    const span = document.createElement('span');
    span.className = 'text-highlighter-extension';
    span.style.backgroundColor = color;
    span.dataset.groupId = groupId;
    span.dataset.spanId = `${groupId}_${spanCounter++}`;
    return span;
  }
  
  // Helper function to finalize current span
  function finalizeCurrentSpan() {
    if (currentSpan && currentSpan.textContent.trim() !== '') {
      highlightSpans.push(currentSpan);
    }
    currentSpan = null;
  }
  
  // Helper function to check if node is a block element
  function isBlockElement(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    
    const blockTags = ['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 
                      'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 
                      'ASIDE', 'MAIN', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 
                      'LI', 'TABLE', 'TR', 'TD', 'TH', 'TBODY', 'THEAD', 
                      'TFOOT', 'FORM', 'FIELDSET', 'ADDRESS'];
    
    return blockTags.includes(node.tagName);
  }
  
  // Helper function to check if we should skip this node
  function shouldSkipNode(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'];
      if (skipTags.includes(node.tagName)) return true;
      
      // Skip if already highlighted
      if (node.classList && node.classList.contains('text-highlighter-extension')) {
        return true;
      }
    }
    return false;
  }
  
  // Tree traversal function
  function traverseNode(node) {
    // Check if we've reached the end
    if (processingStarted && node === endContainer) {
      if (node.nodeType === Node.TEXT_NODE) {
        // Handle end text node
        if (!currentSpan) {
          currentSpan = createNewSpan();
        }
        
        const textContent = node.textContent;
        const selectedText = textContent.substring(0, endOffset);
        
        if (selectedText.trim() !== '') {
          const newTextNode = document.createTextNode(selectedText);
          currentSpan.appendChild(newTextNode);
          
          // Split the text node properly
          const remainingText = textContent.substring(endOffset);
          const parent = node.parentNode;
          
          if (remainingText) {
            const remainingTextNode = document.createTextNode(remainingText);
            parent.insertBefore(currentSpan, node);
            parent.insertBefore(remainingTextNode, node);
            parent.removeChild(node); // Remove the original node
          } else {
            parent.replaceChild(currentSpan, node);
          }
          
          finalizeCurrentSpan();
        } else {
          // If no valid text to highlight, just finalize current span
          finalizeCurrentSpan();
        }
      }
      return true; // Signal to stop processing
    }
    
    // Check if we've reached the start
    if (!processingStarted && node === startContainer) {
      processingStarted = true;
      
      if (node.nodeType === Node.TEXT_NODE) {
        // Handle start text node
        const textContent = node.textContent;
        
        if (startContainer === endContainer) {
          // Same text node case
          const selectedText = textContent.substring(startOffset, endOffset);
          
          if (selectedText.trim() !== '') {
            currentSpan = createNewSpan();
            const newTextNode = document.createTextNode(selectedText);
            currentSpan.appendChild(newTextNode);
            
            // Split the text node
            const beforeText = textContent.substring(0, startOffset);
            const afterText = textContent.substring(endOffset);
            
            const parent = node.parentNode;
            if (beforeText) {
              const beforeTextNode = document.createTextNode(beforeText);
              parent.insertBefore(beforeTextNode, node);
            }
            
            parent.insertBefore(currentSpan, node);
            
            if (afterText) {
              const afterTextNode = document.createTextNode(afterText);
              parent.insertBefore(afterTextNode, node);
            }
            
            parent.removeChild(node);
            finalizeCurrentSpan();
          }
          return true; // Signal to stop processing
        } else {
          // Multi-node selection start
          const selectedText = textContent.substring(startOffset);
          
          if (selectedText.trim() !== '') {
            currentSpan = createNewSpan();
            const newTextNode = document.createTextNode(selectedText);
            currentSpan.appendChild(newTextNode);
            
            // Split the text node
            const beforeText = textContent.substring(0, startOffset);
            const parent = node.parentNode;
            
            if (beforeText) {
              const beforeTextNode = document.createTextNode(beforeText);
              parent.insertBefore(beforeTextNode, node);
            }
            
            parent.replaceChild(currentSpan, node);
            finalizeCurrentSpan();
            currentSpan = createNewSpan();
          }
        }
      }
      return false; // Continue processing
    }
    
    // Process nodes between start and end
    if (processingStarted) {
      if (shouldSkipNode(node)) {
        return false; // Skip but continue
      }

      if (range.comparePoint(node, 0) === 1) {
        debugLog('Stop traversing over range', node);
        return true;
      }
      
      if (node.nodeType === Node.TEXT_NODE) {
        const textContent = node.textContent;
        if (textContent.trim() !== '') {
          if (!currentSpan) {
            currentSpan = createNewSpan();
          }
          
          const newTextNode = document.createTextNode(textContent);
          currentSpan.appendChild(newTextNode);
          
          // Replace the original text node
          node.parentNode.replaceChild(currentSpan, node);
          finalizeCurrentSpan();
          currentSpan = createNewSpan();
        }
      } else if (node.nodeType === Node.ELEMENT_NODE && isBlockElement(node)) {
        // Block element encountered - finalize current span
        finalizeCurrentSpan();
        currentSpan = null;
      }
    }
    
    return false; // Continue processing
  }
  
  // Perform depth-first traversal
  function depthFirstTraversal(node) {
    if (traverseNode(node)) {
      return true; // Stop signal received
    }
    
    // Process child nodes
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (depthFirstTraversal(child)) {
        return true; // Stop signal received
      }
    }
    
    return false;
  }
  
  // Start traversal from common ancestor
  depthFirstTraversal(commonAncestor);
  
  // Finalize any remaining span
  finalizeCurrentSpan();
  
  return highlightSpans;
}
