const DEBUG_MODE = false;

var debugLog = DEBUG_MODE ? console.log.bind(console) : () => {};
var errorLog = DEBUG_MODE ? console.error.bind(console) : () => {};

// Cross-browser compatibility: use browser API in Firefox, chrome API in Chromium.
var browserAPI = window.browserAPI || (() => {
  if (typeof browser !== 'undefined') {
    return browser;
  }
  if (typeof chrome !== 'undefined') {
    return chrome;
  }
  throw new Error('Neither browser nor chrome API is available');
})();
window.browserAPI = browserAPI;

// i18n helper shared by content scripts.
function getMessage(key, substitutions = null) {
  return browserAPI.i18n.getMessage(key, substitutions);
}

// ---- Highlight scroll/flash helpers (shared by minimap and popup jump) ----

// Timers for the temporary flash emphasis, keyed by highlight element.
var highlightFlashTimers = new Map();

// Smooth-scroll the page so the given highlight element is near the top.
function scrollToHighlightElement(highlightElement) {
  if (!highlightElement) return;

  const rect = highlightElement.getBoundingClientRect();
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const absoluteTop = rect.top + scrollTop;

  // Adjust scroll position (to position slightly above)
  const scrollToPosition = absoluteTop - 100;

  window.scrollTo({
    top: scrollToPosition,
    behavior: 'smooth'
  });
}

// Temporarily emphasize every span in the element's highlight group.
function flashHighlightGroup(highlightElement) {
  if (!highlightElement) return;

  const groupId = highlightElement.dataset.groupId;
  const highlightElements = groupId
    ? Array.from(document.querySelectorAll(`.text-highlighter-extension[data-group-id='${groupId}']`))
    : [highlightElement];

  highlightElements.forEach((element) => {
    if (highlightFlashTimers.has(element)) {
      clearTimeout(highlightFlashTimers.get(element));
      highlightFlashTimers.delete(element);
    }

    const isAlreadyHighlighted = element.hasAttribute('data-highlighted');

    if (!isAlreadyHighlighted) {
      element.dataset.originalBoxShadow = element.style.boxShadow;
      element.dataset.originalTransition = element.style.transition;
      element.dataset.originalZIndex = element.style.zIndex;

      element.setAttribute('data-highlighted', 'true');
    }

    element.style.boxShadow = '0 0 0 3px rgba(255, 255, 255, 0.7), 0 0 0 6px rgba(0, 0, 0, 0.3)';
    element.style.transition = 'box-shadow 0.3s';
    element.style.zIndex = '10000'; // Display above other elements

    const timerId = setTimeout(() => {
      if (element.hasAttribute('data-highlighted')) {
        element.style.boxShadow = element.dataset.originalBoxShadow || '';
        element.style.transition = element.dataset.originalTransition || '';
        element.style.zIndex = element.dataset.originalZIndex || '';

        element.removeAttribute('data-highlighted');
        delete element.dataset.originalBoxShadow;
        delete element.dataset.originalTransition;
        delete element.dataset.originalZIndex;
      }

      highlightFlashTimers.delete(element);
    }, 1500);

    highlightFlashTimers.set(element, timerId);
  });
}
