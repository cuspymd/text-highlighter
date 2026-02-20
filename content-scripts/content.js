let highlights = [];
const currentUrl = window.location.href;

let currentColors = [];
const contentCore = window.TextHighlighterCore;

// Minimap manager instance
let minimapManager = null;

window.TextHighlighterState = {
  get() {
    return {
      highlights,
      currentColors,
      activeHighlightId: activeHighlightElement?.dataset?.groupId || null,
    };
  },
  set(nextState = {}) {
    if (Array.isArray(nextState.highlights)) {
      highlights = nextState.highlights;
    }
    if (Array.isArray(nextState.currentColors)) {
      currentColors = nextState.currentColors;
    }
    if (Object.prototype.hasOwnProperty.call(nextState, 'activeHighlightId') && !nextState.activeHighlightId) {
      activeHighlightElement = null;
    }
  },
};

window.TextHighlighterContentAPI = {
  highlightSelection(color) {
    highlightSelectedText(color);
  },
  removeHighlightByElement(element) {
    removeHighlight(element);
  },
  changeHighlightColor(element, color) {
    changeHighlightColor(element, color);
  },
  refreshColors(colors) {
    currentColors = colors || currentColors;
    refreshHighlightControlsColors();
  },
};

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
    // Delete all spans in the group
    const groupSpans = document.querySelectorAll(`.text-highlighter-extension[data-group-id='${groupId}']`);
    groupSpans.forEach(span => {
      const parent = span.parentNode;
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
    });
    // Remove group from highlights array
    highlights = highlights.filter(g => g.groupId !== groupId);
    if (groupId) {
      browserAPI.runtime.sendMessage(
        {
          action: 'deleteHighlight',
          url: currentUrl,
          groupId,
          notifyRefresh: true
        },
        (response) => {
          if (browserAPI.runtime.lastError) {
            debugLog('Failed to delete highlight via background:', browserAPI.runtime.lastError);
            return;
          }
          if (!response || !response.success) {
            debugLog('Delete highlight via background was not successful:', response);
          }
        }
      );
    }
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
  // Change color of all spans in the DOM
  const groupSpans = document.querySelectorAll(`.text-highlighter-extension[data-group-id='${groupId}']`);
  groupSpans.forEach(span => {
    span.style.backgroundColor = newColor;
  });
  // Change color in highlights array
  const group = highlights.find(g => g.groupId === groupId);
  if (group) {
    group.color = newColor;
    group.updatedAt = Date.now();
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

  // 1. Collect text nodes
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

  // 2. First span: select the closest candidate based on position
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
  // Select candidate closest to position
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
  // 3. Apply highlight to the first span
  let currentNodeIdx = textNodes.indexOf(bestCandidate.node);
  let currentCharIdx = bestCandidate.idx;
  let highlightSpans = [];
  for (let s = 0; s < spanInfos.length; s++) {
    const spanInfo = spanInfos[s];
    const spanText = spanInfo.text;
    let found = false;
    // Subsequent spans match only in text nodes sequentially
    for (; currentNodeIdx < textNodes.length; currentNodeIdx++) {
      const node = textNodes[currentNodeIdx];
      const nodeText = node.textContent;
      let searchStart = (s === 0) ? currentCharIdx : 0;
      const idx = nodeText.indexOf(spanText, searchStart);
      if (idx !== -1) {
        let range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + spanText.length);
        // Apply highlight
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
        // Search for the next span starting after this node
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

  // Hover effect for the entire group
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
  if (!contentCore || typeof contentCore.convertSelectionRange !== 'function') {
    return range;
  }
  return contentCore.convertSelectionRange(range, debugLog);
}

// Refactored highlightSelectedText function with tree traversal algorithm
function highlightSelectedText(color) {
  const selection = window.getSelection();
  const selectedText = selection.toString();
  if (selectedText.trim() === '') return;

  // Check if the selection overlaps with an existing highlight to prevent nesting.
  const rangeToCheck = selection.getRangeAt(0);
  if (
    contentCore
    && typeof contentCore.selectionOverlapsHighlight === 'function'
    && contentCore.selectionOverlapsHighlight(rangeToCheck)
  ) {
    debugLog('Selection overlaps with an existing highlight. Aborting highlight creation.');
    selection.removeAllRanges();
    return;
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
      const group = (
        contentCore
        && typeof contentCore.buildHighlightGroup === 'function'
      )
        ? contentCore.buildHighlightGroup({ groupId, color, selectedText, highlightSpans })
        : {
            groupId,
            color,
            text: selectedText,
            updatedAt: Date.now(),
            spans: [],
          };

      highlightSpans.forEach((span, index) => {
        if (!group.spans[index]) {
          const rect = span.getBoundingClientRect();
          const scrollTop = window.scrollY || document.documentElement.scrollTop;
          group.spans.push({
            spanId: `${groupId}_${index}`,
            text: span.textContent,
            position: rect.top + scrollTop,
          });
        }
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
  if (!contentCore || typeof contentCore.processSelectionRange !== 'function') {
    return [];
  }
  return contentCore.processSelectionRange(range, color, groupId);
}

// Selection controls functionality is now handled in controls.js
