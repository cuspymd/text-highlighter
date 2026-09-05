let highlights = [];
let currentUrl = window.location.href.replace(/#selection-[\d.]+-[\d.]+$/, '');

let currentColors = [];
const contentCore = window.TextHighlighterCore;

// Minimap manager instance
let minimapManager = null;
const NAVIGATION_BRIDGE_SOURCE = 'text-highlighter-navigation-bridge';
let pendingNavigationRestoreTimer = null;

// Content that arrives after the initial restore - lazy-loaded comments, an
// expanded section, an SPA view still settling - leaves highlights unrestorable
// even though their text turns up moments later. One delayed pass over just the
// failures recovers those. It is deliberately a single timer and not a
// MutationObserver: an observer would re-run the restore on ordinary page churn.
const RESTORE_RETRY_DELAY_MS = 1500;
let restoreRetryTimeout = null;
let hasScheduledRestoreRetry = false;

// Whether a restore pass is still coming. The popup asks for this so it can
// wait rather than marking entries missing that are simply not restored yet - a
// mark it would never take back.
//
// This has to be a state and not a deadline. The path to the first restore runs
// through two message round trips - colors, then the stored highlights - and a
// cold service worker can make either of them long. A timestamp set up front
// would report "done" while the page had not even asked for its highlights yet.
// The deadline it keeps only says when it is worth asking again.
const PENDING_RESTORE_RECHECK_MS = 300;
const restoreCore = window.TextHighlighterRestoreCore;
const restorePendingState = restoreCore.createRestorePendingState({
  recheckMs: PENDING_RESTORE_RECHECK_MS,
});

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

function injectNavigationBridge() {
  const bridgeId = 'text-highlighter-navigation-bridge';
  if (document.getElementById(bridgeId)) return;

  const script = document.createElement('script');
  script.id = bridgeId;
  script.src = browserAPI.runtime.getURL('content-scripts/navigation-bridge.js');
  script.async = false;
  script.onload = () => {
    script.remove();
  };
  script.onerror = () => {
    debugLog('Failed to inject navigation bridge');
    script.remove();
  };

  (document.documentElement || document.head || document.body).appendChild(script);
}

function handleUrlChange(nextUrl, trigger = 'unknown') {
  const normalizedUrl = nextUrl ? nextUrl.replace(/#selection-[\d.]+-[\d.]+$/, '') : nextUrl;
  if (!normalizedUrl || normalizedUrl === currentUrl) return;

  debugLog('Detected URL change:', {
    trigger,
    previousUrl: currentUrl,
    nextUrl: normalizedUrl,
  });

  currentUrl = normalizedUrl;
  highlights = [];

  if (typeof hideHighlightControls === 'function') {
    hideHighlightControls();
  }

  clearAllHighlights();
  updateMinimapMarkers();

  // A retry queued for the previous URL holds that page's groups, so it must not
  // outlive the navigation.
  clearRestoreRetryTimeout();
  hasScheduledRestoreRetry = false;

  if (pendingNavigationRestoreTimer) {
    clearTimeout(pendingNavigationRestoreTimer);
  }

  markRestorePending(1000);
  pendingNavigationRestoreTimer = setTimeout(() => {
    pendingNavigationRestoreTimer = null;
    loadHighlights();
  }, 1000);
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  const data = event.data;
  if (!data || data.source !== NAVIGATION_BRIDGE_SOURCE || data.type !== 'location-changed') {
    return;
  }

  if (data.href !== window.location.href) {
    debugLog('Ignoring navigation bridge message with mismatched URL:', {
      reportedHref: data.href,
      actualHref: window.location.href,
    });
    return;
  }

  handleUrlChange(data.href, data.trigger);
});

injectNavigationBridge();

// The restore is already pending here, from the initial value of restorePending:
// this round trip is part of the wait, and the popup can open during it. The
// deadline is only set once the timer it describes actually exists.
getColorsFromBackground().then(() => {
  markRestorePending(500);
  setTimeout(() => {
    loadHighlights();
    createHighlightControls();
  }, 500);
}).catch(error => {
  console.error('Failed to load colors from background:', error);
  // Nothing will call loadHighlights now, so no restore is coming.
  clearRestorePending();
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
  else if (message.action === 'setOneClickHighlight') {
    setOneClickHighlightEnabled(message.enabled);
    sendResponse({ success: true });
    return true;
  }
  else if (message.action === 'setSelectionControlsVisibility') {
    setSelectionControlsVisibility(message.visible);
    sendResponse({ success: true });
    return true;
  }
  else if (message.action === 'getRestoredGroupIds') {
    sendResponse({
      success: true,
      groupIds: Array.from(collectRestoredGroupIds()),
      pendingRestoreMs: getPendingRestoreMs()
    });
    return true;
  }
  else if (message.action === 'retryRestoreHighlight') {
    const groupId = message.groupId != null ? String(message.groupId) : '';
    const group = highlights.find(candidate => String(candidate.groupId) === groupId);

    if (!group) {
      debugLog('retryRestoreHighlight: unknown group:', groupId);
      sendResponse({ success: false, reason: 'unknown-group' });
      return true;
    }

    if (findHighlightElementsByGroupId(groupId).length > 0) {
      sendResponse({ success: true, restored: true });
      return true;
    }

    const failed = processRestoreGroups([group], 'popup retry');
    updateMinimapMarkers();

    sendResponse({ success: true, restored: failed.length === 0 });
    return true;
  }
  else if (message.action === 'scrollToHighlight') {
    const groupId = message.groupId != null ? String(message.groupId) : '';
    const target = groupId ? findHighlightElementsByGroupId(groupId)[0] : null;

    if (target) {
      scrollToHighlightElement(target);
      flashHighlightGroup(target);
      sendResponse({ success: true });
    } else {
      debugLog('scrollToHighlight: no element found for group:', groupId);
      sendResponse({ success: false, reason: 'not-found' });
    }
    return true;
  }
});

// Function to asynchronously get color information from Background Service Worker
// A background that is not listening rejects, which the caller already handles.
async function getColorsFromBackground() {
  const response = await browserAPI.runtime.sendMessage({ action: 'getColors' });

  if (!response || !response.colors) {
    throw new Error('Invalid response from background for colors.');
  }

  currentColors = response.colors;
  debugLog('Received colors from background:', currentColors);
  // The same refresh the colorsUpdated broadcast does. The palette arriving is
  // a change like any other: a selection icon raised while this round trip was
  // still out was drawn with no palette to offer, and would otherwise keep
  // saying so while a press resolved a colour and painted with it.
  refreshHighlightControlsColors();
}

async function loadHighlights() {
  debugLog('Loading highlights for URL:', currentUrl);
  const requestUrl = currentUrl;

  // A background that is not listening rejects rather than setting lastError.
  // That is the same "no answer" this already handles below, and it still has to
  // clear the pending restore - dropping out here would leave the popup waiting.
  let response = null;
  try {
    response = await browserAPI.runtime.sendMessage({ action: 'getHighlights', url: requestUrl });
  } catch (error) {
    debugLog('No answer for highlights:', error);
  }

  if (requestUrl !== currentUrl) {
    debugLog('Ignoring stale highlights response for previous URL:', requestUrl);
    return;
  }

  debugLog('Got highlights response:', response);
  if (response && response.highlights) {
    highlights = response.highlights;
    applyHighlights();
  } else {
    debugLog('No highlights found or invalid response');
    // No pass is coming, so stop reporting one as pending.
    clearRestorePending();
  }

  initMinimap();
}

// `deletedGroupIds` names groups this save drops, so the background can record
// their tombstones in the same write. Sending a separate deleteHighlight first
// would race this save: both rewrite the page's list, and whichever the
// background finishes second wins.
function saveHighlights(deletedGroupIds = []) {
  browserAPI.runtime.sendMessage({
    action: 'saveHighlights',
    url: currentUrl,
    highlights: highlights,
    ...(deletedGroupIds.length > 0 ? { deletedGroupIds } : {}),
    timestamp: new Date().toISOString()
  })
    .then(response => debugLog('Highlights saved:', response?.success))
    .catch(error => debugLog('Failed to save highlights:', error));
}

// Put highlighted text back the way it was: move the span's children out, drop
// the span, then rejoin the text nodes the wrap had split, so a later text
// search sees one continuous node again.
function unwrapHighlightSpans(spans) {
  spans.forEach(span => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
    parent.normalize();
  });
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
    unwrapHighlightSpans(groupSpans);
    // Remove group from highlights array
    highlights = highlights.filter(g => g.groupId !== groupId);
    if (groupId) {
      browserAPI.runtime.sendMessage({
        action: 'deleteHighlight',
        url: currentUrl,
        groupId,
        notifyRefresh: true
      })
        .then(response => {
          if (!response || !response.success) {
            debugLog('Delete highlight via background was not successful:', response);
          }
        })
        .catch(error => debugLog('Failed to delete highlight via background:', error));
    }
    updateMinimapMarkers();
    if (activeHighlightElement && activeHighlightElement.dataset.groupId === groupId) {
      activeHighlightElement = null;
      hideHighlightControls();
    }
  }
}

// One-click highlighting paints with whatever colour was applied last, so every
// path that applies one records it. There are only two: the selection bar, the
// '+' picker, the context menu and the shortcut slots all arrive at
// highlightSelectedText(), and recolouring an existing highlight is the same
// statement of intent. The value is a hex, not a colour id - see
// resolveLastUsedColor() in color-core.js for why.
//
// Every application writes, including one that repeats the colour this tab used
// before: another tab may have recorded something else since, and skipping the
// write would leave that stale value as "the last one used".
function rememberLastUsedColor(color) {
  if (!color) return;

  try {
    const pending = browserAPI.storage.local.set({ lastUsedColor: color });
    if (pending && typeof pending.catch === 'function') {
      pending.catch(error => debugLog('Could not record the last used colour:', error));
    }
  } catch (error) {
    // An invalidated extension context (a reload while the page is open) must
    // not take the highlight down with it.
    debugLog('Could not record the last used colour:', error);
  }
}

function changeHighlightColor(highlightElement, newColor) {
  if (!highlightElement) return;
  rememberLastUsedColor(newColor);
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
  unwrapHighlightSpans(highlightElements);
}

// Helper to apply highlight from a DOM Range
function applyHighlightFromRange(range, color, groupId) {
  try {
    const convertedRange = convertSelectionRange(range);
    const highlightSpans = processSelectionRange(convertedRange, color, groupId);
    if (highlightSpans.length > 0) {
      highlightSpans.forEach((span, index) => {
        if (!span.dataset.spanId) {
           span.dataset.spanId = `${groupId}_${index}`;
        }
        addHighlightEventListeners(span);
      });
      return true;
    }
  } catch (error) {
    debugLog('Error applying highlight from range:', error);
  }
  return false;
}

function needsQuoteRestore(group) {
  return restoreCore.needsQuoteRestore(group);
}

// Text already inside a highlight span counts as page text here. A pass that
// runs after other groups are applied - the delayed retry, or the popup asking
// for one group - would otherwise resolve against a document with those
// highlights cut out of it: every offset past them shifts, and the prefix and
// suffix a selector uses to tell repeated phrases apart go missing. That picks
// the wrong occurrence. Including them gives every pass the same page text the
// first one saw.
// One walk for a whole pass, rather than a query per group.
function collectRestoredGroupIds() {
  const restored = new Set();

  document.querySelectorAll('.text-highlighter-extension[data-group-id]').forEach(span => {
    restored.add(span.dataset.groupId);
  });

  return restored;
}

function buildRestoreModel() {
  if (!contentCore || typeof contentCore.buildNormalizedTextModel !== 'function') {
    return null;
  }

  return contentCore.buildNormalizedTextModel(document.body, { includeHighlightedText: true });
}

function processRestoreGroups(groups, reason) {
  const quoteGroups = [];
  const legacyGroups = [];

  // Restore passes can overlap - the load timer and a navigation pass both in
  // flight, or a queued retry that another pass has already satisfied. A group
  // that is already on the page must be left alone: its own highlighted text
  // counts as page text to the restore model, so resolving it again finds that
  // text and wraps it a second time, nesting a duplicate span inside the first.
  const alreadyRestored = collectRestoredGroupIds();

  groups.forEach(group => {
    if (alreadyRestored.has(String(group.groupId))) {
      debugLog(`Skipping group already on the page during ${reason}:`, group.groupId);
      return;
    }

    if (needsQuoteRestore(group)) {
      quoteGroups.push(group);
    } else {
      legacyGroups.push(group);
    }
  });

  // Quote restores run first and share one text model. Legacy restores search
  // the live DOM and mutate it, so running them afterwards keeps that shared
  // model valid for the whole quote pass.
  const unresolved = restoreQuoteGroups(quoteGroups, reason);

  const batch = createLegacyRestoreBatch(document.body);
  const failed = [];

  unresolved.concat(legacyGroups).forEach(group => {
    try {
      if (!restoreLegacyGroup(group, batch)) {
        failed.push(group);
      }
    } catch (error) {
      debugLog(`Error during ${reason}:`, error);
      // The DOM may have been left half-modified, so stop trusting the list.
      batch.invalidate();
      failed.push(group);
    }
  });

  return failed;
}

// Restore every quote-based group against a single text model.
//
// Applying a highlight wraps text nodes, which drops the highlighted text out
// of the normalized model and shifts every offset after it - which is why this
// used to rebuild the model once per restored highlight. Instead, resolve all
// the selectors first (pure string work, no DOM writes), then apply the matches
// from the end of the document backwards, so each application only disturbs
// document positions the pending matches are already past.
//
// That keeps the *offsets* valid but not always the node references: two matches
// inside one text node detach it for the second, so the apply loop rebuilds the
// model when it finds a range pointing at a node that has left the document.
// A page whose highlights sit in separate text nodes - the normal case - builds
// the model once.
//
// Returns the groups that could not be placed, for the legacy span fallback.
function restoreQuoteGroups(groups, reason) {
  if (groups.length === 0) return [];

  let model = null;
  try {
    model = buildRestoreModel();
  } catch (e) {
    debugLog(`Error building text model for ${reason}:`, e);
  }

  if (!model || !contentCore || typeof contentCore.resolveQuoteSelector !== 'function') {
    return groups.slice();
  }

  const unresolved = [];
  const claimed = [];
  const matches = [];

  groups.forEach(group => {
    try {
      const match = resolveUnclaimedMatch(model, group, claimed);
      if (!match) {
        unresolved.push(group);
        return;
      }

      claimed.push(match);
      matches.push({ group, start: match.start, end: match.end });
    } catch (e) {
      debugLog('Quote resolution failed, falling back to legacy spans:', e);
      unresolved.push(group);
    }
  });

  matches.sort((a, b) => b.start - a.start);

  matches.forEach(entry => {
    try {
      let range = contentCore.normalizedOffsetsToRange(model, entry.start, entry.end);

      if (!isRangeInDocument(range)) {
        // An earlier application in this pass replaced the text node this match
        // was resolved against - highlighting rebuilds a text node rather than
        // splitting it, so two matches inside one node detach it for the second.
        // Everything applied so far lies later in the document, so offsets below
        // it are unchanged: a rebuilt model answers the same offsets with live
        // nodes. Only a colliding match pays for this.
        const rebuilt = buildRestoreModel();
        if (rebuilt) {
          model = rebuilt;
          range = contentCore.normalizedOffsetsToRange(model, entry.start, entry.end);
        }
      }

      if (isRangeInDocument(range) && applyHighlightFromRange(range, entry.group.color, entry.group.groupId)) {
        debugLog('Restored highlight using quote selector:', entry.group.groupId);
        return;
      }

      unresolved.push(entry.group);
    } catch (e) {
      debugLog('Quote restoration failed, falling back to legacy spans:', e);
      unresolved.push(entry.group);
    }
  });

  return unresolved;
}

// Resolve a group's quote selector to a region no earlier group has taken.
// Rebuilding the model after each restore used to guarantee this implicitly,
// because the restored text left the model. Retrying over a masked copy of the
// model text reproduces that without a rebuild: masking preserves length, so
// offsets still map onto the same segments.
function resolveUnclaimedMatch(model, group, claimed) {
  return restoreCore.resolveUnclaimedMatch(contentCore, model, group, claimed);
}

function overlapsClaimedRegion(claimed, region) {
  return restoreCore.overlapsClaimedRegion(claimed, region);
}

function isRangeInDocument(range) {
  return restoreCore.isRangeInDocument(range);
}

function maskClaimedRegions(text, claimed) {
  return restoreCore.maskClaimedRegions(text, claimed);
}

// Fallback for groups saved without quote selectors, and for quote groups that
// could not be placed against the current DOM.
function restoreLegacyGroup(group, batch = null) {
  if (group.spans && group.spans.length > 0) {
     const success = highlightTextInDocument(
        document.body,
        group.spans,
        group.color,
        group.groupId,
        batch
     );
     if (success) {
        debugLog('Restored highlight using legacy spans:', group.groupId);
        return true;
     }
  }

  debugLog('Failed to restore highlight group:', group.groupId);
  return false;
}

function markRestorePending(delayMs) {
  restorePendingState.mark(delayMs);
}

function clearRestorePending() {
  restorePendingState.clear();
}

function getPendingRestoreMs() {
  return restorePendingState.remainingMs();
}

function clearRestoreRetryTimeout() {
  if (restoreRetryTimeout) {
    clearTimeout(restoreRetryTimeout);
    restoreRetryTimeout = null;
  }
}

// One retry per restore cycle. A page that genuinely no longer contains the text
// would otherwise pay for the pass again and again with nothing to show.
function scheduleSingleRestoreRetry(failedGroups) {
  if (hasScheduledRestoreRetry || !failedGroups || failedGroups.length === 0) {
    return;
  }

  hasScheduledRestoreRetry = true;
  clearRestoreRetryTimeout();
  markRestorePending(RESTORE_RETRY_DELAY_MS);

  restoreRetryTimeout = setTimeout(() => {
    restoreRetryTimeout = null;
    debugLog('Retrying failed highlight restores once after delay:', failedGroups.length, 'groups');
    processRestoreGroups(failedGroups, 'delayed restore retry');
    clearRestorePending();
    updateMinimapMarkers();
  }, RESTORE_RETRY_DELAY_MS);
}

// Apply highlights to the page using saved highlight information
function applyHighlights() {
  debugLog('Applying highlights, count:', highlights.length);

  clearRestoreRetryTimeout();
  hasScheduledRestoreRetry = false;

  highlights.forEach(group => {
    debugLog('Applying highlight group:', group);
  });

  const failed = processRestoreGroups(highlights, 'initial restore');
  clearRestorePending();
  updateMinimapMarkers();
  scheduleSingleRestoreRetry(failed);
}

// Walk the document once for the text nodes a legacy restore may search.
function collectRestorableTextNodes(root) {
  const isDisplayed = createVisibilityResolver();

  const walker = document.createTreeWalker(
    root,
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
        if (!isDisplayed(parent)) {
          return NodeFilter.FILTER_REJECT;
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
  return textNodes;
}

// Share one text node list across a run of legacy restores.
//
// Collecting the list is a full document walk, and it used to run once per
// group. A group that matches nothing leaves the DOM untouched - which is the
// shape of a batch of unplaceable highlights, and exactly what a delayed retry
// would process - so the list is collected once and dropped only when a group is
// about to change the DOM.
function createLegacyRestoreBatch(root) {
  let textNodes = null;

  return {
    textNodes() {
      if (!textNodes) {
        textNodes = collectRestorableTextNodes(root);
      }
      return textNodes;
    },
    invalidate() {
      textNodes = null;
    },
  };
}

// Find text in document and apply highlight for a group of spans
function highlightTextInDocument(element, spanInfos, color, groupId, batch = null) {
  if (!spanInfos || spanInfos.length === 0) return false;

  // 1. Collect text nodes
  const textNodes = batch ? batch.textNodes() : collectRestorableTextNodes(element);
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
  //
  // Past this point the DOM changes, including when a later span in this group
  // is not found and the group still reports failure, so any shared node list is
  // dropped here rather than on success.
  if (batch) batch.invalidate();

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
      // Do not strand the group half applied. Text already wrapped is skipped by
      // the next restore's walker, so a retry could no longer find this group's
      // own first span and might attach the rest of it to another occurrence of
      // the same text - and the leftover span would read as a restored group to
      // getRestoredGroupIds. Put the DOM back instead.
      unwrapHighlightSpans(highlightSpans);
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

    if (!minimapManager) {
      minimapManager = new MinimapManager();
      minimapManager.init();
    }

    minimapManager.setVisibility(minimapVisible);

    minimapManager.updateMarkers();

    debugLog('Minimap initialized with visibility:', minimapVisible);
  });
}

function updateMinimapMarkers() {
  if (minimapManager) {
    minimapManager.updateMarkers();
  }
}

function describeNodeForDebug(node) {
  if (!node) return null;

  if (node.nodeType === Node.TEXT_NODE) {
    return {
      type: 'text',
      parentTag: node.parentNode ? node.parentNode.tagName : null,
      textPreview: (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      textLength: (node.textContent || '').length,
    };
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    return {
      type: 'element',
      tag: node.tagName,
      childCount: node.childNodes.length,
      textPreview: (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    };
  }

  return {
    type: `node-${node.nodeType}`,
    name: node.nodeName,
  };
}

function describeRangeForDebug(range) {
  if (!range) return null;

  return {
    text: range.toString().replace(/\s+/g, ' ').trim(),
    startContainer: describeNodeForDebug(range.startContainer),
    startOffset: range.startOffset,
    endContainer: describeNodeForDebug(range.endContainer),
    endOffset: range.endOffset,
    commonAncestorContainer: describeNodeForDebug(range.commonAncestorContainer),
  };
}

// Convert selection range when all containers are the same node
function convertSelectionRange(range) {
  if (!contentCore || typeof contentCore.convertSelectionRange !== 'function') {
    return range;
  }
  return contentCore.convertSelectionRange(range, debugLog);
}

// Memoized visibility test for one tree walk. content-core.js is declared ahead
// of this file in the manifest, so the fallback only guards against the core
// module failing to evaluate; treating everything as hidden keeps a broken core
// from highlighting text the user cannot see.
function createVisibilityResolver() {
  if (!contentCore || typeof contentCore.createVisibilityResolver !== 'function') {
    return () => false;
  }
  return contentCore.createVisibilityResolver();
}

// Refactored highlightSelectedText function with tree traversal algorithm
function highlightSelectedText(color) {
  const selection = window.getSelection();
  const selectedText = selection.toString();
  if (selectedText.trim() === '') return;

  rememberLastUsedColor(color);

  const range = selection.getRangeAt(0);

  // A selection that touches existing highlights merges with them rather than
  // nesting inside them: one new group in the chosen colour covers the
  // selection and every group it touched. That is how a highlight is extended,
  // recoloured, or joined to its neighbour - none of which needs the old
  // delete-and-reselect detour.
  const overlapping = (
    contentCore && typeof contentCore.overlappingHighlightGroupIds === 'function'
  )
    ? contentCore.overlappingHighlightGroupIds(range)
    : new Set();
  if (overlapping.size > 0) {
    debugLog('Selection overlaps existing highlights, merging:', Array.from(overlapping));
    mergeSelectionIntoHighlights(range, overlapping, color);
    selection.removeAllRanges();
    return;
  }

  debugLog('Highlight Selection Debug:', {
    selectedText: selectedText.replace(/\s+/g, ' ').trim(),
    range: describeRangeForDebug(range),
    anchorNode: describeNodeForDebug(selection.anchorNode),
    anchorOffset: selection.anchorOffset,
    focusNode: describeNodeForDebug(selection.focusNode),
    focusOffset: selection.focusOffset,
    isCollapsed: selection.isCollapsed,
    rangeCount: selection.rangeCount,
  });

  // Convert range if common ancestor and start container are the same node
  const convertedRange = convertSelectionRange(range);
  debugLog('Converted Highlight Range Debug:', describeRangeForDebug(convertedRange));

  createHighlightGroup(convertedRange, color, selectedText);
  selection.removeAllRanges();
}

// Replace the groups a selection touches with one group over their union.
//
// Everything happens in the text model's offsets, not the DOM: the selection
// and each touched group become [start, end) regions, the union is taken, the
// old spans are unwrapped, and the union is applied the way a restore applies a
// resolved selector. Unwrapping changes no page text, so the offsets survive
// the rebuild. Highlighting through nested spans never comes up.
//
// A selection that stays inside a single group and reaches no further than it
// is a recolour, and the group is kept rather than replaced.
function mergeSelectionIntoHighlights(range, groupIds, color) {
  const model = buildRestoreModel();
  const selected = model ? contentCore.rangeToTextPosition(model, convertSelectionRange(range)) : null;
  if (!selected) {
    debugLog('Could not place the selection in the page text; highlights left as they are');
    return false;
  }

  const groups = [];
  for (const groupId of groupIds) {
    const spans = findHighlightElementsByGroupId(groupId);
    const region = contentCore.highlightGroupTextRegion(model, spans);
    if (!region) {
      // Unwrapping a group whose text cannot be placed would lose it for good.
      debugLog('Could not place highlight group in the page text; not merging:', groupId);
      return false;
    }
    groups.push({ groupId, spans, region });
  }

  const union = { start: selected.start, end: selected.end };
  groups.forEach(({ region }) => {
    union.start = Math.min(union.start, region.start);
    union.end = Math.max(union.end, region.end);
  });

  if (groups.length === 1
    && groups[0].region.start === union.start
    && groups[0].region.end === union.end) {
    changeHighlightColor(groups[0].spans[0], color);
    return true;
  }

  const removed = groups.map(({ groupId }) => groupId);
  groups.forEach(({ spans }) => unwrapHighlightSpans(spans));
  highlights = highlights.filter(group => !removed.includes(String(group.groupId)));
  if (activeHighlightElement && removed.includes(activeHighlightElement.dataset.groupId)) {
    activeHighlightElement = null;
    hideHighlightControls();
  }

  const rebuilt = buildRestoreModel();
  const mergedRange = rebuilt
    ? contentCore.normalizedOffsetsToRange(rebuilt, union.start, union.end)
    : null;
  if (!mergedRange) {
    // The old groups are already off the page; keep storage in step with it.
    debugLog('Could not build a range for the merged highlight:', union);
    saveHighlights(removed);
    updateMinimapMarkers();
    return false;
  }

  const mergedText = rebuilt.text.substring(union.start, union.end);
  return createHighlightGroup(mergedRange, color, mergedText, { deletedGroupIds: removed });
}

// Wrap `range` in a new group, save it, and report whether anything was created.
function createHighlightGroup(convertedRange, color, selectedText, { deletedGroupIds = [] } = {}) {
  try {
    const groupId = Date.now().toString();

    // Generate selectors for robust restoration.
    //
    // Built against the same page text a restore resolves against - other
    // highlights included. Leaving them out cuts their text from the prefix,
    // suffix and offsets the selector carries, so a page with a highlight on
    // either side of this one saved context with holes in it, and a repeated
    // phrase could restore onto the wrong occurrence.
    let selectors = null;
    if (contentCore && typeof contentCore.buildNormalizedTextModel === 'function') {
      try {
        const model = contentCore.buildNormalizedTextModel(document.body, { includeHighlightedText: true });
        const quote = contentCore.buildQuoteSelector(model, convertedRange);
        const textPosition = contentCore.rangeToTextPosition(model, convertedRange);
        if (quote && textPosition) {
          selectors = { quote, textPosition };
        }
      } catch (err) {
        debugLog('Error building selectors:', err);
      }
    }

    const highlightSpans = processSelectionRange(convertedRange, color, groupId);
    if (highlightSpans.length > 0) {
      const group = (
        contentCore
        && typeof contentCore.buildHighlightGroup === 'function'
      )
        ? contentCore.buildHighlightGroup({ groupId, color, selectedText, highlightSpans, selectors })
        : {
            groupId,
            color,
            text: selectedText,
            updatedAt: Date.now(),
            spans: [],
            ...(selectors ? { selectors } : {})
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
      saveHighlights(deletedGroupIds);
      updateMinimapMarkers();
      return true;
    }
  } catch (error) {
    debugLog('Error highlighting selected text:', error);
  }
  return false;
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
