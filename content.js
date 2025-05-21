let highlights = [];
const currentUrl = window.location.href;

const DEBUG_MODE = false;

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

// Process highlighting for selected text
function highlightSelectedText(color) {
  const selection = window.getSelection();

  if (selection.toString().trim() === '') return;

  const range = selection.getRangeAt(0);
  const selectionContents = range.extractContents();
  const span = document.createElement('span');

  span.appendChild(selectionContents);
  span.className = 'text-highlighter-extension';
  span.style.backgroundColor = color;

  // Create unique ID
  span.dataset.highlightId = Date.now().toString();

  range.insertNode(span);

  // Calculate highlight position information
  const rect = span.getBoundingClientRect();
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const position = rect.top + scrollTop;

  highlights.push({
    id: span.dataset.highlightId,
    text: span.textContent,
    color: color,
    xpath: getXPathForElement(span),
    position: position
  });

  addHighlightEventListeners(span);

  saveHighlights();
  updateMinimapMarkers();

  selection.removeAllRanges();
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
  if (!text || text.length < 3) return false; // Skip too short text

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
