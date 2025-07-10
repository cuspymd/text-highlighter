let highlights = [];
const currentUrl = window.location.href;

let currentColors = [];

// Minimap manager instance
let minimapManager = null;

// i18n support function
function getMessage(key, substitutions = null) {
  return browserAPI.i18n.getMessage(key, substitutions);
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

// Event listener is now combined below to handle both highlight and selection controls

// Handle messages received from background
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'highlight') {
    highlightSelectedText(message.color);
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
  else if (message.action === 'setSelectionControlsVisibility') {
    setSelectionControlsVisibility(message.visible);
    sendResponse({ success: true });
    return true;
  }
});

// Function to asynchronously get color information from Background Service Worker
function getColorsFromBackground() {
  return new Promise((resolve, reject) => {
    browserAPI.runtime.sendMessage({ action: 'getColors' }, (response) => {
      if (browserAPI.runtime.lastError) {
        console.error('Error getting colors:', browserAPI.runtime.lastError);
        return reject(browserAPI.runtime.lastError);
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

  browserAPI.runtime.sendMessage(
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
  browserAPI.runtime.sendMessage(
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

function initMinimap() {
  browserAPI.storage.local.get(['minimapVisible'], (result) => {
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

// Convert selection range when all containers are the same node
function convertSelectionRange(range) {
  const commonAncestor = range.commonAncestorContainer;
  const startContainer = range.startContainer;
  const endContainer = range.endContainer;
  
  // Check if common ancestor and start container are the same node
  if (commonAncestor === startContainer) {
    // Find the child node at start offset
    if (commonAncestor.childNodes && range.startOffset < commonAncestor.childNodes.length) {
      const childNode = commonAncestor.childNodes[range.startOffset];
      
      // Check if child node is a text node
      if (childNode && childNode.nodeType === Node.TEXT_NODE) {
        const convertedRange = document.createRange();
        convertedRange.setStart(childNode, 0);
        convertedRange.setEnd(range.endContainer, range.endOffset);
        
        debugLog('Converted Range:', {
          commonAncestorContainer: convertedRange.commonAncestorContainer,
          startContainer: convertedRange.startContainer,
          endContainer: convertedRange.endContainer,
          startOffset: convertedRange.startOffset,
          endOffset: convertedRange.endOffset
        });
        
        return convertedRange;
      }
    }
  }
  
  return range;
}

// Refactored highlightSelectedText function with tree traversal algorithm
function highlightSelectedText(color) {
  const selection = window.getSelection();
  const selectedText = selection.toString();
  if (selectedText.trim() === '') return;

  // Check if the selection overlaps with an existing highlight to prevent nesting.
  const rangeToCheck = selection.getRangeAt(0);
  const existingHighlights = document.querySelectorAll('.text-highlighter-extension');
  for (const hl of existingHighlights) {
    // intersectsNode returns true if any part of the node is inside the range.
    if (rangeToCheck.intersectsNode(hl)) {
      debugLog('Selection overlaps with an existing highlight. Aborting highlight creation.');
      selection.removeAllRanges();
      return;
    }
  }

  const range = selection.getRangeAt(0);
  debugLog('Highlight Range:', {
    commonAncestorContainer: range.commonAncestorContainer,
    startContainer: range.startContainer,
    endContainer: range.endContainer,
    startOffset: range.startOffset,
    endOffset: range.endOffset
  });

  // Convert range if common ancestor and start container are the same node
  const convertedRange = convertSelectionRange(range);

  try {
    const groupId = Date.now().toString();
    const highlightSpans = processSelectionRange(convertedRange, color, groupId);
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

// Selection controls functionality is now handled in controls.js
