let highlights = [];
const currentUrl = window.location.href;

const DEBUG_MODE = true;

let COLORS = [];

// Highlight controller UI container
let highlightControlsContainer = null;
let activeHighlightElement = null;

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
  loadHighlights();
  createHighlightControls();
}).catch(error => {
  console.error('Failed to load colors from background:', error);
  createHighlightControls();
});

// Add event listener to hide controller when clicking other areas
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
        COLORS = response.colors;
        debugLog('Received colors from background:', COLORS);
        resolve();
      } else {
        reject('Invalid response from background for colors.');
      }
    });
  });
}

// Load saved highlights
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

      // Initialize minimap
      initMinimap();
    }
  );
}

// Save highlights
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

// Remove highlight
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

    // Remove corresponding item from highlights array
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

// Change highlight color
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
  highlights.forEach(highlight => {
    try {
      // Try text-based search
      debugLog('Applying highlight:', highlight.text);
      const textFound = highlightTextInDocument(
        document.body,
        highlight.text,
        highlight.color,
        highlight.id
      );

      if (!textFound) {
        debugLog('Text not found by content, trying XPath');
        // Try XPath-based search
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

// Find text in document and apply highlight
function highlightTextInDocument(element, text, color, id) {
  if (!text || text.trim().length === 0) {
    debugLog('Skipping highlight, search text is empty:', text);
    return false;
  }
  const normalizedSearchText = text.trim(); // Normalize search text (e.g. remove leading/trailing whitespace)
  // More advanced normalization (e.g., collapsing multiple spaces to one) can be done here
  // if highlight.text was stored with such normalization.
  // For now, assuming highlight.text (from span.textContent) is reasonably representative.

  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function (node) {
        // Filter out only truly empty text nodes. Nodes with only whitespace are kept.
        if (!node.nodeValue || node.nodeValue === '') {
          return NodeFilter.FILTER_REJECT;
        }

        const parent = node.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT; // Should not happen in a valid document

        // Reject nodes within existing highlights
        if (parent.classList && parent.classList.contains('text-highlighter-extension')) {
          return NodeFilter.FILTER_REJECT;
        }

        // Reject nodes within certain tags
        const parentTagName = parent.tagName.toUpperCase();
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'].includes(parentTagName)) {
          return NodeFilter.FILTER_REJECT;
        }

        // Reject nodes that are not visible (display:none)
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
    debugLog('No suitable text nodes found for searching:', normalizedSearchText);
    return false;
  }

  for (let i = 0; i < textNodes.length; i++) { // Iterate through each node as a potential start
    const startNodeCandidate = textNodes[i];
    const startNodeText = startNodeCandidate.textContent;

    for (let j = 0; j < startNodeText.length; j++) { // Iterate through each char in node as potential start
      let currentSearchIdx = 0; // Pointer in normalizedSearchText
      let currentDomNodeIdx = i;
      let currentDomCharIdx = j;

      let possibleMatch = true;

      while (currentSearchIdx < normalizedSearchText.length && currentDomNodeIdx < textNodes.length) {
        const domNode = textNodes[currentDomNodeIdx];
        const domText = domNode.textContent;

        if (currentDomCharIdx < domText.length) {
          // Basic character comparison. More sophisticated whitespace handling could be added here if needed.
          // E.g., if normalizedSearchText has single spaces for multiple in DOM.
          if (domText[currentDomCharIdx] === normalizedSearchText[currentSearchIdx]) {
            currentSearchIdx++;
            currentDomCharIdx++;
          } else {
            possibleMatch = false;
            break;
          }
        } else { // Reached end of current DOM node's text
          currentDomNodeIdx++;
          currentDomCharIdx = 0; // Start from beginning of next DOM node
        }
      }

      if (possibleMatch && currentSearchIdx === normalizedSearchText.length) {
        // Match found
        const range = document.createRange();
        range.setStart(startNodeCandidate, j);

        // Determine end node and offset
        // currentDomNodeIdx might be one past the last node if match ended at node boundary
        // currentDomCharIdx is the offset in the node where matching stopped (or 0 if moved to next node)
        const endNode = textNodes[currentDomNodeIdx < textNodes.length ? currentDomNodeIdx : currentDomNodeIdx - 1];
        const endOffset = currentDomCharIdx === 0 && currentDomNodeIdx > i ?
          textNodes[currentDomNodeIdx - 1].textContent.length : currentDomCharIdx;
        range.setEnd(endNode, endOffset);

        // Prevent re-highlighting already highlighted content by this function call
        if (range.commonAncestorContainer.parentElement && range.commonAncestorContainer.parentElement.closest('.text-highlighter-extension')) {
          debugLog('Skipping highlight, part of range already in a highlight span:', normalizedSearchText);
          continue; // Try next starting point
        }

        const span = document.createElement('span');
        span.className = 'text-highlighter-extension';
        span.style.backgroundColor = color;
        span.dataset.highlightId = id;

        try {
          const contents = range.extractContents(); // Removes content from DOM and returns it in a fragment
          span.appendChild(contents); // Add the extracted content to the new span
          range.insertNode(span); // Insert the span at the (now collapsed) range start

          addHighlightEventListeners(span);
          debugLog('Text found and highlighted (multi-node capable):', normalizedSearchText);
          return true; // Highlighted one instance
        } catch (e) {
          debugLog('Error creating highlight (multi-node extract/insert):', e, "Search:", normalizedSearchText, "Range text before potential modification:", range.toString());
          // Continue search from next char (j loop)
        }
      }
    }
  }
  debugLog('Text not found (multi-node capable):', normalizedSearchText);
  return false;
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
      showHighlightControls(highlightElement);

      e.stopPropagation();
    }
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

// Get element by XPath
function getElementByXPath(xpath) {
  return document.evaluate(
    xpath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  ).singleNodeValue;
}

// Generate XPath for element
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

// Create highlight controller UI
function createHighlightControls() {
  if (highlightControlsContainer) return;

  highlightControlsContainer = document.createElement('div');
  highlightControlsContainer.className = 'text-highlighter-controls';
  highlightControlsContainer.style.display = 'none';

  // Create delete button
  const deleteButton = document.createElement('div');
  deleteButton.className = 'text-highlighter-control-button delete-highlight';
  deleteButton.innerHTML = '×';
  deleteButton.title = getMessage('deleteHighlight');
  deleteButton.addEventListener('click', function (e) {
    if (activeHighlightElement) {
      removeHighlight(activeHighlightElement);
    }
    e.stopPropagation();
  });

  // Color buttons container
  const colorButtonsContainer = document.createElement('div');
  colorButtonsContainer.className = 'text-highlighter-color-buttons';

  // Create color buttons
  COLORS.forEach(colorInfo => {
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

  document.body.appendChild(highlightControlsContainer);
}

// Display highlight controller UI
function showHighlightControls(highlightElement) {
  if (!highlightControlsContainer) createHighlightControls();

  const firstTextPosition = getFirstTextNodePosition(highlightElement);
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

  highlightControlsContainer.style.top = (firstTextPosition.top + scrollTop - 30) + 'px';
  highlightControlsContainer.style.left = (firstTextPosition.left + scrollLeft) + 'px';
  highlightControlsContainer.style.display = 'flex';
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
    highlightControlsContainer.style.display = 'none';
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
  if (selection.toString().trim() === '') return;

  const range = selection.getRangeAt(0);
  debugLog('Highlight Range:', {
    commonAncestorContainer: range.commonAncestorContainer,
    startContainer: range.startContainer,
    endContainer: range.endContainer,
    startOffset: range.startOffset,
    endOffset: range.endOffset
  });
  //return;
   
  try {
    const highlightId = Date.now().toString();
    const highlightSpans = processSelectionRange(range, color, highlightId);
    
    if (highlightSpans.length > 0) {
      // Store highlight data for each created span
      highlightSpans.forEach((span, index) => {
        const rect = span.getBoundingClientRect();
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        
        highlights.push({
          id: `${highlightId}_${index}`,
          text: span.textContent,
          color: color,
          xpath: getXPathForElement(span),
          position: rect.top + scrollTop
        });
        
        addHighlightEventListeners(span);
      });
      
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
 * @param {string} highlightId - Base highlight ID
 * @returns {Array} Array of created highlight spans
 */
function processSelectionRange(range, color, highlightId) {
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
    span.dataset.highlightId = `${highlightId}_${spanCounter++}`;
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

// Add module exports for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    highlightSelectedText,
    highlights,
    getXPathForElement,
    addHighlightEventListeners,
    updateMinimapMarkers,
    saveHighlights,
    COLORS
  };
}
