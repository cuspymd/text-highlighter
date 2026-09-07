(() => {
  // Blank out already-claimed regions so an exact-text search cannot land on
  // them again. The filler must be a character the normalized model never
  // contains, or the mask could create a match of its own.
  const CLAIMED_REGION_FILLER = '\u0000';

  /**
   * @typedef {Object} ClaimedRegion
   * @property {number} start
   * @property {number} end
   */

  /**
   * Whether a group carries the quote selector the modern restore resolves
   * against. Groups saved before selectors existed fall back to their spans.
   *
   * @param {Object} group
   * @returns {boolean}
   */
  function needsQuoteRestore(group) {
    return Boolean(group && group.selectors && group.selectors.quote);
  }

  /**
   * @param {ClaimedRegion[]} claimed
   * @param {ClaimedRegion} region
   * @returns {boolean}
   */
  function overlapsClaimedRegion(claimed, region) {
    return claimed.some(taken => region.start < taken.end && region.end > taken.start);
  }

  /**
   * Replace every claimed region with filler, leaving offsets untouched.
   *
   * split('') keeps one entry per UTF-16 code unit, matching the offsets that
   * indexOf/substring produce inside resolveQuoteSelector. Array.from would
   * group surrogate pairs and misalign every offset past the first emoji.
   *
   * @param {string} text
   * @param {ClaimedRegion[]} claimed
   * @returns {string}
   */
  function maskClaimedRegions(text, claimed) {
    const chars = text.split('');

    claimed.forEach(taken => {
      const end = Math.min(taken.end, chars.length);
      for (let i = Math.max(taken.start, 0); i < end; i++) {
        chars[i] = CLAIMED_REGION_FILLER;
      }
    });

    return chars.join('');
  }

  /**
   * A range built from a stale model can point at a detached node. Highlighting
   * one of those silently succeeds against the orphan, so it has to be caught
   * before the range is applied rather than after.
   *
   * @param {Range} range
   * @returns {boolean}
   */
  function isRangeInDocument(range) {
    return Boolean(
      range
      && range.startContainer && range.startContainer.isConnected
      && range.endContainer && range.endContainer.isConnected
    );
  }

  /**
   * Resolve a group's quote selector to a region no earlier group has taken.
   *
   * Two highlights on the same phrase resolve to the same occurrence on the
   * first try, so the loser retries against a model with the winner's region
   * masked out. Returns null when the selector does not resolve at all, or only
   * ever onto ground already claimed.
   *
   * @param {Object} core `window.TextHighlighterCore`
   * @param {{text: string, segments: Object[]}} model
   * @param {Object} group
   * @param {ClaimedRegion[]} claimed
   * @returns {ClaimedRegion|null}
   */
  function resolveUnclaimedMatch(core, model, group, claimed) {
    const exactText = group.selectors.quote.exact || group.text;
    const hints = { textPosition: group.selectors.textPosition };

    const match = core.resolveQuoteSelector(model, group.selectors.quote, exactText, hints);
    if (!match) return null;
    if (!overlapsClaimedRegion(claimed, match)) return match;

    const maskedModel = {
      text: maskClaimedRegions(model.text, claimed),
      segments: model.segments,
    };

    const retry = core.resolveQuoteSelector(maskedModel, group.selectors.quote, exactText, hints);
    if (!retry || overlapsClaimedRegion(claimed, retry)) return null;

    return retry;
  }

  /**
   * Whether a refreshHighlights message would leave the page as it is.
   *
   * Every save is echoed back to the tab that made it: the background writes
   * the page's groups to storage.sync, its own onChanged listener merges that
   * write and broadcasts the result to every tab on the url - the saving tab
   * included. Rebuilding the page for that echo unwraps every span and rejoins
   * the text nodes around it, which changes how many spans a group is made of
   * and detaches any selection the user has made since. So a refresh that
   * carries exactly the groups already on the page is dropped.
   *
   * Groups are compared by identity, colour and updatedAt: a change from
   * another device arrives with a newer updatedAt, and a group removed there
   * arrives as a shorter list.
   *
   * @param {Array<Object>} currentGroups - the groups the page holds
   * @param {Array<Object>} incomingGroups - the groups the refresh carries
   * @param {Set<string>} restoredGroupIds - ids of the groups actually on the page
   * @returns {boolean}
   */
  function refreshChangesNothing(currentGroups, incomingGroups, restoredGroupIds) {
    const current = Array.isArray(currentGroups) ? currentGroups : [];
    const incoming = Array.isArray(incomingGroups) ? incomingGroups : [];
    if (current.length !== incoming.length) return false;

    const currentById = new Map(current.map(group => [String(group.groupId), group]));
    if (currentById.size !== current.length) return false;

    return incoming.every(group => {
      const id = String(group.groupId);
      const held = currentById.get(id);
      return Boolean(held)
        && held.color === group.color
        && (held.updatedAt || 0) === (group.updatedAt || 0)
        && restoredGroupIds.has(id);
    });
  }

  /**
   * Whether a restore is still coming, and how long the popup should wait
   * before asking again.
   *
   * The popup asks the page rather than guessing, so this has to answer during
   * the gap between "the page loaded" and "the highlights are on it" - a gap
   * that spans a message round trip of unknown length plus a queued timer. It
   * starts pending, because on a fresh page a restore always is.
   *
   * @param {{recheckMs?: number, now?: () => number}} options
   */
  function createRestorePendingState({ recheckMs = 300, now = Date.now } = {}) {
    let pending = true;
    let deadline = 0;

    return {
      /**
       * A pass is coming in `delayMs`. Never brings an existing deadline
       * closer: two passes in flight finish no sooner than the later one.
       */
      mark(delayMs) {
        pending = true;
        deadline = Math.max(deadline, now() + delayMs);
      },

      clear() {
        pending = false;
        deadline = 0;
      },

      /**
       * Zero once the pass has actually run. While one is still coming, how
       * long to wait before asking again: until the queued timer is due, or a
       * short recheck once it is, since what is left then is a round trip of
       * unknown length. The caller caps its own total wait, so a page that
       * never finishes restoring does not hold the popup forever.
       */
      remainingMs() {
        if (!pending) return 0;
        return Math.max(deadline - now(), recheckMs);
      },

      get isPending() {
        return pending;
      },
    };
  }

  window.TextHighlighterRestoreCore = {
    CLAIMED_REGION_FILLER,
    needsQuoteRestore,
    overlapsClaimedRegion,
    maskClaimedRegions,
    isRangeInDocument,
    resolveUnclaimedMatch,
    createRestorePendingState,
    refreshChangesNothing,
  };
})();
