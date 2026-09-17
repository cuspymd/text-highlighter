(() => {
  // Tops within this many pixels of the viewport edge count as on it, so a
  // highlight the page could not scroll exactly into place is not picked again.
  const EDGE_TOLERANCE_PX = 2;

  /**
   * @typedef {Object} JumpGroup
   * @property {string} id
   * @property {number} top  Absolute page offset of the group's first span.
   */

  /**
   * Put groups in reading order: top to bottom, document order on ties.
   * Array.prototype.sort is stable, so the caller's document order survives.
   *
   * @param {JumpGroup[]} groups
   * @returns {JumpGroup[]}
   */
  function orderJumpGroups(groups) {
    return [...groups].sort((a, b) => a.top - b.top);
  }

  /**
   * Choose the group a next/previous shortcut should land on.
   *
   * With a current group - the last jump, still in view - the answer is its
   * neighbour in reading order. Without one it is the first group below the
   * viewport top (next) or the last one above it (previous), so a jump starts
   * from where the reader is rather than from wherever they jumped long ago.
   * Both directions wrap around at the ends of the page.
   *
   * @param {JumpGroup[]} groups  In reading order.
   * @param {'next'|'previous'} direction
   * @param {{ currentId?: string|null, viewportTop: number }} position
   * @returns {JumpGroup|null}
   */
  function pickJumpTarget(groups, direction, { currentId = null, viewportTop }) {
    if (!groups.length) return null;
    const forward = direction !== 'previous';

    const currentIndex = currentId == null ? -1 : groups.findIndex(group => group.id === currentId);
    if (currentIndex !== -1) {
      const step = forward ? 1 : -1;
      return groups[(currentIndex + step + groups.length) % groups.length];
    }

    if (forward) {
      return groups.find(group => group.top > viewportTop + EDGE_TOLERANCE_PX) || groups[0];
    }
    const above = groups.filter(group => group.top < viewportTop - EDGE_TOLERANCE_PX);
    return above[above.length - 1] || groups[groups.length - 1];
  }

  window.TextHighlighterJumpCore = {
    EDGE_TOLERANCE_PX,
    orderJumpGroups,
    pickJumpTarget,
  };
})();
