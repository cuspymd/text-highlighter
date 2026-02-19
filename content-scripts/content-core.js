(() => {
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
    const commonAncestor = range.commonAncestorContainer;
    const startContainer = range.startContainer;

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
      if (node.nodeType !== Node.ELEMENT_NODE) return false;

      const blockTags = [
        'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
        'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV',
        'ASIDE', 'MAIN', 'BLOCKQUOTE', 'PRE', 'UL', 'OL',
        'LI', 'TABLE', 'TR', 'TD', 'TH', 'TBODY', 'THEAD',
        'TFOOT', 'FORM', 'FIELDSET', 'ADDRESS',
      ];

      return blockTags.includes(node.tagName);
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
   * @param {object} params
   * @param {string} params.groupId
   * @param {string} params.color
   * @param {string} params.selectedText
   * @param {HTMLElement[]} params.highlightSpans
   * @param {function(HTMLElement): number} [params.getSpanPosition]
   * @returns {HighlightGroup}
   */
  function buildHighlightGroup({
    groupId,
    color,
    selectedText,
    highlightSpans,
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
  };
})();
