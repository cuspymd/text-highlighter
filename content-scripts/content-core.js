(() => {
  const BLOCK_TAGS = [
    'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV',
    'ASIDE', 'MAIN', 'BLOCKQUOTE', 'PRE', 'UL', 'OL',
    'LI', 'TABLE', 'TR', 'TD', 'TH', 'TBODY', 'THEAD',
    'TFOOT', 'FORM', 'FIELDSET', 'ADDRESS',
  ];

  /**
   * @typedef {Object} HighlightSpan
   * @property {string} spanId
   * @property {string} text
   * @property {number} position
   */

  /**
   * @typedef {Object} HighlightGroup
   * @property {string} groupId
   * @property {string} color
   * @property {string} text
   * @property {number} updatedAt
   * @property {HighlightSpan[]} spans
   */

  /**
   * @typedef {Object} SelectionSnapshot
   * @property {Range} range
   * @property {string} text
   */

  /**
   * Convert selection range when all containers are the same node.
   * @param {Range} range
   * @param {Function} logger
   * @returns {Range}
   */
  function convertSelectionRange(range, logger = () => {}) {
    function isBlockElement(node) {
      return node && node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.includes(node.tagName);
    }

    function normalizeText(text) {
      return (text || '').replace(/\s+/g, ' ').trim();
    }

    function getExactSelectionRoot(node, selectedText) {
      let current = node && node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
      while (current && current !== document.body && current !== document.documentElement) {
        if (current.nodeType === Node.ELEMENT_NODE && normalizeText(current.textContent) === selectedText) {
          return current;
        }
        current = current.parentNode;
      }
      return null;
    }

    function getSelectionRootFromStartBoundary(startNode, startOffset, selectedText) {
      if (!startNode || startNode.nodeType !== Node.ELEMENT_NODE) {
        return null;
      }

      const candidateChild = startNode.childNodes && startNode.childNodes[startOffset];
      let candidate = candidateChild && candidateChild.nodeType === Node.TEXT_NODE
        ? candidateChild.parentNode
        : candidateChild;

      while (candidate && candidate !== startNode) {
        if (candidate.nodeType === Node.ELEMENT_NODE && normalizeText(candidate.textContent) === selectedText) {
          return candidate;
        }
        candidate = candidate.parentNode;
      }

      return null;
    }

    function findMatchingElementInSubtree(root, selectedText) {
      if (!root || root.nodeType !== Node.ELEMENT_NODE) {
        return null;
      }

      if (normalizeText(root.textContent) === selectedText) {
        return root;
      }

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
      let currentNode;
      while (currentNode = walker.nextNode()) {
        if (normalizeText(currentNode.textContent) === selectedText) {
          return currentNode;
        }
      }

      return null;
    }

    function getSelectionRootFromBoundaryRange(container, startOffset, endOffset, selectedText) {
      if (!container || container.nodeType !== Node.ELEMENT_NODE) {
        return null;
      }

      const maxOffset = Math.min(endOffset, container.childNodes.length);
      for (let index = startOffset; index < maxOffset; index++) {
        const child = container.childNodes[index];
        if (!child) continue;

        if (child.nodeType === Node.ELEMENT_NODE) {
          const match = findMatchingElementInSubtree(child, selectedText);
          if (match) {
            return match;
          }
        } else if (child.nodeType === Node.TEXT_NODE) {
          const parent = child.parentNode;
          if (
            parent
            && parent !== container
            && parent.nodeType === Node.ELEMENT_NODE
            && normalizeText(parent.textContent) === selectedText
          ) {
            return parent;
          }
        }
      }

      return null;
    }

    function findLastSelectableTextNode(root) {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const parent = node.parentNode;
            if (!parent) return NodeFilter.FILTER_REJECT;
            if (parent.classList && parent.classList.contains('text-highlighter-extension')) {
              return NodeFilter.FILTER_REJECT;
            }
            const parentTagName = parent.tagName && parent.tagName.toUpperCase();
            if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'].includes(parentTagName)) {
              return NodeFilter.FILTER_REJECT;
            }
            return node.textContent && node.textContent.trim() !== ''
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT;
          }
        },
        false
      );

      let lastNode = null;
      let currentNode;
      while (currentNode = walker.nextNode()) {
        lastNode = currentNode;
      }
      return lastNode;
    }

    function findFirstSelectableTextNode(root) {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const parent = node.parentNode;
            if (!parent) return NodeFilter.FILTER_REJECT;
            if (parent.classList && parent.classList.contains('text-highlighter-extension')) {
              return NodeFilter.FILTER_REJECT;
            }
            const parentTagName = parent.tagName && parent.tagName.toUpperCase();
            if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'].includes(parentTagName)) {
              return NodeFilter.FILTER_REJECT;
            }
            return node.textContent && node.textContent.trim() !== ''
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT;
          }
        },
        false
      );

      return walker.nextNode();
    }

    function getVisibleTextStartOffset(text) {
      for (let i = 0; i < text.length; i++) {
        if (!/\s/.test(text[i])) {
          return i;
        }
      }
      return 0;
    }

    function getVisibleTextEndOffset(text) {
      for (let i = text.length - 1; i >= 0; i--) {
        if (!/\s/.test(text[i])) {
          return i + 1;
        }
      }
      return text.length;
    }

    const commonAncestor = range.commonAncestorContainer;
    const startContainer = range.startContainer;
    const selectedText = normalizeText(range.toString());
    const selectionRoot = selectedText !== ''
      ? (
          getExactSelectionRoot(startContainer, selectedText)
          || getSelectionRootFromStartBoundary(startContainer, range.startOffset, selectedText)
          || getSelectionRootFromBoundaryRange(startContainer, range.startOffset, range.endOffset, selectedText)
        )
      : null;

    // Triple-click selections on some pages can resolve to element boundaries:
    // start on the selected element itself and end at the next sibling block with
    // offset 0. Rebuild the range from the first/last text nodes of the exact
    // selected container before mutating the DOM.
    if (selectionRoot) {
      const firstTextNode = findFirstSelectableTextNode(selectionRoot);
      const lastTextNode = findLastSelectableTextNode(selectionRoot);
      if (firstTextNode && lastTextNode) {
        const startOffset = getVisibleTextStartOffset(firstTextNode.textContent || '');
        const endOffset = getVisibleTextEndOffset(lastTextNode.textContent || '');
        const convertedRange = document.createRange();
        convertedRange.setStart(firstTextNode, startOffset);
        convertedRange.setEnd(lastTextNode, endOffset);

        logger('Clamped Range To Selected Root:', {
          commonAncestorContainer: convertedRange.commonAncestorContainer,
          startContainer: convertedRange.startContainer,
          endContainer: convertedRange.endContainer,
          startOffset: convertedRange.startOffset,
          endOffset: convertedRange.endOffset,
        });

        return convertedRange;
      }
    }

    if (commonAncestor === startContainer) {
      if (commonAncestor.childNodes && range.startOffset < commonAncestor.childNodes.length) {
        const childNode = commonAncestor.childNodes[range.startOffset];

        if (childNode && childNode.nodeType === Node.TEXT_NODE) {
          const convertedRange = document.createRange();
          convertedRange.setStart(childNode, 0);
          convertedRange.setEnd(range.endContainer, range.endOffset);

          logger('Converted Range:', {
            commonAncestorContainer: convertedRange.commonAncestorContainer,
            startContainer: convertedRange.startContainer,
            endContainer: convertedRange.endContainer,
            startOffset: convertedRange.startOffset,
            endOffset: convertedRange.endOffset,
          });

          return convertedRange;
        }
      }
    }

    return range;
  }

  /**
   * Process selection range using tree traversal algorithm.
   * @param {Range} range
   * @param {string} color
   * @param {string} groupId
   * @returns {HTMLElement[]}
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

    function createNewSpan() {
      const span = document.createElement('span');
      span.className = 'text-highlighter-extension';
      span.style.backgroundColor = color;
      span.dataset.groupId = groupId;
      span.dataset.spanId = `${groupId}_${spanCounter++}`;
      return span;
    }

    function finalizeCurrentSpan() {
      if (currentSpan && currentSpan.textContent.trim() !== '') {
        highlightSpans.push(currentSpan);
      }
      currentSpan = null;
    }

    function isBlockElement(node) {
      return node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.includes(node.tagName);
    }

    function shouldSkipNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'];
        if (skipTags.includes(node.tagName)) return true;
        if (node.classList && node.classList.contains('text-highlighter-extension')) {
          return true;
        }
      }
      return false;
    }

    function traverseNode(node) {
      if (processingStarted && node === endContainer) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (!currentSpan) {
            currentSpan = createNewSpan();
          }

          const textContent = node.textContent;
          const selectedText = textContent.substring(0, endOffset);

          if (selectedText.trim() !== '') {
            const newTextNode = document.createTextNode(selectedText);
            currentSpan.appendChild(newTextNode);

            const remainingText = textContent.substring(endOffset);
            const parent = node.parentNode;

            if (remainingText) {
              const remainingTextNode = document.createTextNode(remainingText);
              parent.insertBefore(currentSpan, node);
              parent.insertBefore(remainingTextNode, node);
              parent.removeChild(node);
            } else {
              parent.replaceChild(currentSpan, node);
            }

            finalizeCurrentSpan();
          } else {
            finalizeCurrentSpan();
          }
        }
        return true;
      }

      if (!processingStarted && node === startContainer) {
        processingStarted = true;

        if (node.nodeType === Node.TEXT_NODE) {
          const textContent = node.textContent;

          if (startContainer === endContainer) {
            const selectedText = textContent.substring(startOffset, endOffset);

            if (selectedText.trim() !== '') {
              currentSpan = createNewSpan();
              const newTextNode = document.createTextNode(selectedText);
              currentSpan.appendChild(newTextNode);

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
            return true;
          } else {
            const selectedText = textContent.substring(startOffset);

            if (selectedText.trim() !== '') {
              currentSpan = createNewSpan();
              const newTextNode = document.createTextNode(selectedText);
              currentSpan.appendChild(newTextNode);

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
        return false;
      }

      if (processingStarted) {
        if (shouldSkipNode(node)) {
          return false;
        }

        if (range.comparePoint(node, 0) === 1) {
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
            node.parentNode.replaceChild(currentSpan, node);
            finalizeCurrentSpan();
            currentSpan = createNewSpan();
          }
        } else if (node.nodeType === Node.ELEMENT_NODE && isBlockElement(node)) {
          finalizeCurrentSpan();
          currentSpan = null;
        }
      }

      return false;
    }

    function depthFirstTraversal(node) {
      if (traverseNode(node)) {
        return true;
      }

      const children = Array.from(node.childNodes);
      for (const child of children) {
        if (depthFirstTraversal(child)) {
          return true;
        }
      }

      return false;
    }

    depthFirstTraversal(commonAncestor);
    finalizeCurrentSpan();

    return highlightSpans;
  }

  /**
   * @param {Range} range
   * @returns {boolean}
   */
  function selectionOverlapsHighlight(range) {
    const existingHighlights = document.querySelectorAll('.text-highlighter-extension');
    for (const highlight of existingHighlights) {
      if (range.intersectsNode(highlight)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Build a normalized text model from a root node.
   * @param {Node} root - The root element to build the model from (e.g., document.body).
   * @returns {Object} { text: string, segments: Array }
   */
  function buildNormalizedTextModel(root) {
    let normalizedText = '';
    const segments = [];
    let currentLength = 0;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          const parent = node.parentNode;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.classList && parent.classList.contains('text-highlighter-extension')) {
            return NodeFilter.FILTER_REJECT;
          }
          const parentTagName = parent.tagName && parent.tagName.toUpperCase();
          if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT'].includes(parentTagName)) {
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

    let currentNode;
    while (currentNode = walker.nextNode()) {
      const rawText = currentNode.nodeValue;
      if (!rawText) continue;

      let nText = '';
      const mapping = [];

      for (let i = 0; i < rawText.length; i++) {
        const char = rawText[i];
        if (/\s/.test(char)) {
          if (nText.length === 0 || nText[nText.length - 1] !== ' ') {
            nText += ' ';
            mapping.push(i);
          }
        } else {
          nText += char;
          mapping.push(i);
        }
      }

      if (nText.length > 0) {
        segments.push({
          node: currentNode,
          normalizedStart: currentLength,
          normalizedEnd: currentLength + nText.length,
          normalizedToRaw: mapping,
        });
        normalizedText += nText;
        currentLength += nText.length;
      }
    }

    return { text: normalizedText, segments };
  }

  /**
   * Convert a DOM range to a text position using the normalized model.
   * @param {Object} model - The normalized text model.
   * @param {Range} range - The DOM range.
   * @returns {Object|null} { start: number, end: number }
   */
  function rangeToTextPosition(model, range) {
    let startPos = -1;
    let endPos = -1;

    // Helper to find normalized offset for a node and raw offset
    function findNormalizedOffset(node, offset, isEnd) {
      for (const segment of model.segments) {
        if (segment.node === node) {
          if (offset === 0) return segment.normalizedStart;
          if (offset >= node.nodeValue.length) return segment.normalizedEnd;

          for (let i = 0; i < segment.normalizedToRaw.length; i++) {
            if (segment.normalizedToRaw[i] === offset) {
              return segment.normalizedStart + i;
            }
          }
          // Fallback if exactly matching offset not in mapping (e.g. collapsed spaces)
          for (let i = 0; i < segment.normalizedToRaw.length; i++) {
            if (segment.normalizedToRaw[i] > offset) {
              return segment.normalizedStart + i;
            }
          }
          return segment.normalizedEnd;
        }
      }
      return -1;
    }

    // Start container
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      startPos = findNormalizedOffset(range.startContainer, range.startOffset, false);
    } else {
      // Find first text node in start container
      const walker = document.createTreeWalker(range.startContainer, NodeFilter.SHOW_TEXT, null, false);
      const textNode = walker.nextNode();
      if (textNode) startPos = findNormalizedOffset(textNode, 0, false);
    }

    // End container
    if (range.endContainer.nodeType === Node.TEXT_NODE) {
      endPos = findNormalizedOffset(range.endContainer, range.endOffset, true);
    } else {
      // Find last text node in end container or next node
       // This is a simplification, might need more robust end resolution
      endPos = startPos + range.toString().length; // Rough fallback
    }

    // If endPos couldn't be accurately resolved from text node, estimate it
    if (endPos === -1 && startPos !== -1) {
       endPos = startPos + range.toString().length;
    }

    if (startPos !== -1 && endPos !== -1 && endPos >= startPos) {
      return { start: startPos, end: endPos };
    }
    return null;
  }

  /**
   * Build a quote selector for a range.
   * @param {Object} model - The normalized text model.
   * @param {Range} range - The DOM range.
   * @param {Object} [options]
   * @returns {Object|null} { exact: string, prefix: string, suffix: string }
   */
  function buildQuoteSelector(model, range, options = {}) {
    const pos = rangeToTextPosition(model, range);
    if (!pos) return null;

    const prefixLen = options.prefixLen || 24;
    const suffixLen = options.suffixLen || 24;

    const exact = model.text.substring(pos.start, pos.end);
    let prefixStart = pos.start - prefixLen;
    if (prefixStart < 0) prefixStart = 0;
    const prefix = model.text.substring(prefixStart, pos.start);

    let suffixEnd = pos.end + suffixLen;
    if (suffixEnd > model.text.length) suffixEnd = model.text.length;
    const suffix = model.text.substring(pos.end, suffixEnd);

    return { exact, prefix, suffix };
  }

  /**
   * Resolve a quote selector against a text model.
   * @param {Object} model - The normalized text model.
   * @param {Object} selector - The quote selector { exact, prefix, suffix }.
   * @param {string} exactText - The exact text to find.
   * @param {Object} [hints] - Optional hints like { textPosition: { start, end } }.
   * @returns {Object|null} { start: number, end: number }
   */
  function resolveQuoteSelector(model, selector, exactText, hints = {}) {
    if (!selector || !exactText) return null;

    const candidates = [];
    let searchIdx = 0;

    // 1. Find all exact match candidates
    while (searchIdx < model.text.length) {
      const idx = model.text.indexOf(exactText, searchIdx);
      if (idx === -1) break;

      candidates.push({ start: idx, end: idx + exactText.length });
      searchIdx = idx + 1; // can be +exactText.length if we assume no overlap
    }

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // 2. Score candidates based on prefix/suffix match and position hint
    let bestCandidate = candidates[0];
    let maxScore = -1;

    for (const c of candidates) {
      let score = 0;

      // Score prefix
      if (selector.prefix) {
        const expectedPrefixStart = Math.max(0, c.start - selector.prefix.length);
        const actualPrefix = model.text.substring(expectedPrefixStart, c.start);
        if (actualPrefix.endsWith(selector.prefix)) {
          score += 100;
        } else {
          // Partial match score could be added here
          // simple overlap match
          for(let i = Math.min(selector.prefix.length, actualPrefix.length); i > 0; i--) {
             if (actualPrefix.endsWith(selector.prefix.substring(selector.prefix.length - i))) {
                score += i;
                break;
             }
          }
        }
      }

      // Score suffix
      if (selector.suffix) {
        const expectedSuffixEnd = Math.min(model.text.length, c.end + selector.suffix.length);
        const actualSuffix = model.text.substring(c.end, expectedSuffixEnd);
        if (actualSuffix.startsWith(selector.suffix)) {
          score += 100;
        } else {
           for(let i = Math.min(selector.suffix.length, actualSuffix.length); i > 0; i--) {
             if (actualSuffix.startsWith(selector.suffix.substring(0, i))) {
                score += i;
                break;
             }
          }
        }
      }

      // Tie-breaker: textPosition hint
      if (hints.textPosition && hints.textPosition.start !== undefined) {
         const dist = Math.abs(c.start - hints.textPosition.start);
         // subtract distance penalty
         score -= Math.min(50, dist / 100);
      }

      if (score > maxScore) {
        maxScore = score;
        bestCandidate = c;
      }
    }

    return bestCandidate;
  }

  /**
   * Convert normalized text offsets back to a DOM Range.
   * @param {Object} model - The normalized text model.
   * @param {number} start - The start normalized offset.
   * @param {number} end - The end normalized offset.
   * @returns {Range|null}
   */
  function normalizedOffsetsToRange(model, start, end) {
    if (start < 0 || end > model.text.length || start >= end) return null;

    let startNode = null;
    let startRawOffset = 0;
    let endNode = null;
    let endRawOffset = 0;

    for (const segment of model.segments) {
      // Find start
      if (!startNode && start >= segment.normalizedStart && start < segment.normalizedEnd) {
        startNode = segment.node;
        const localOffset = start - segment.normalizedStart;
        startRawOffset = segment.normalizedToRaw[localOffset];
      }

      // Find end
      if (!endNode && end > segment.normalizedStart && end <= segment.normalizedEnd) {
        endNode = segment.node;
        const localOffset = end - segment.normalizedStart - 1;
        // The end is exclusive, so we find the raw index of the last character
        // and add 1 to it.
        endRawOffset = segment.normalizedToRaw[localOffset] + 1;
      }

      if (startNode && endNode) break;
    }

    if (startNode && endNode) {
      const range = document.createRange();
      try {
        range.setStart(startNode, startRawOffset);
        range.setEnd(endNode, endRawOffset);
        return range;
      } catch (e) {
        return null;
      }
    }

    return null;
  }

  /**
   * @param {object} params
   * @param {string} params.groupId
   * @param {string} params.color
   * @param {string} params.selectedText
   * @param {HTMLElement[]} params.highlightSpans
   * @param {Object} [params.selectors]
   * @param {function(HTMLElement): number} [params.getSpanPosition]
   * @returns {HighlightGroup}
   */
  function buildHighlightGroup({
    groupId,
    color,
    selectedText,
    highlightSpans,
    selectors,
    getSpanPosition,
  }) {
    const resolvePosition = getSpanPosition || ((span) => {
      const rect = span.getBoundingClientRect();
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      return rect.top + scrollTop;
    });

    const group = {
      groupId,
      color,
      text: selectedText,
      updatedAt: Date.now(),
      spans: [],
    };

    if (selectors) {
      group.selectors = selectors;
    }

    highlightSpans.forEach((span, index) => {
      const spanId = `${groupId}_${index}`;
      span.dataset.groupId = groupId;
      span.dataset.spanId = spanId;
      group.spans.push({
        spanId,
        text: span.textContent,
        position: resolvePosition(span),
      });
    });

    return group;
  }

  window.TextHighlighterCore = {
    convertSelectionRange,
    processSelectionRange,
    selectionOverlapsHighlight,
    buildHighlightGroup,
    buildNormalizedTextModel,
    rangeToTextPosition,
    buildQuoteSelector,
    resolveQuoteSelector,
    normalizedOffsetsToRange,
  };
})();
