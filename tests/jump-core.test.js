import '../content-scripts/jump-core.js';

describe('jump-core', () => {
  const jump = window.TextHighlighterJumpCore;
  const groups = [
    { id: 'a', top: 100 },
    { id: 'b', top: 500 },
    { id: 'c', top: 900 },
  ];

  describe('orderJumpGroups', () => {
    it('orders by top and keeps document order for groups on the same line', () => {
      const ordered = jump.orderJumpGroups([
        { id: 'late', top: 300 },
        { id: 'first-on-line', top: 100 },
        { id: 'second-on-line', top: 100 },
      ]);

      expect(ordered.map(group => group.id)).toEqual(['first-on-line', 'second-on-line', 'late']);
    });

    it('does not reorder the array it was given', () => {
      const input = [{ id: 'b', top: 2 }, { id: 'a', top: 1 }];
      jump.orderJumpGroups(input);

      expect(input.map(group => group.id)).toEqual(['b', 'a']);
    });
  });

  describe('pickJumpTarget', () => {
    it('returns null when there is nothing to jump to', () => {
      expect(jump.pickJumpTarget([], 'next', { viewportTop: 0 })).toBeNull();
    });

    it('moves from the current group to its neighbour', () => {
      expect(jump.pickJumpTarget(groups, 'next', { currentId: 'a', viewportTop: 0 }).id).toBe('b');
      expect(jump.pickJumpTarget(groups, 'previous', { currentId: 'c', viewportTop: 0 }).id).toBe('b');
    });

    it('wraps around at both ends', () => {
      expect(jump.pickJumpTarget(groups, 'next', { currentId: 'c', viewportTop: 0 }).id).toBe('a');
      expect(jump.pickJumpTarget(groups, 'previous', { currentId: 'a', viewportTop: 0 }).id).toBe('c');
    });

    it('follows the current group even where the page could not scroll it to the top', () => {
      // Near the bottom of a page the viewport stops short, so the position alone
      // would keep naming the same group.
      expect(jump.pickJumpTarget(groups, 'next', { currentId: 'b', viewportTop: 450 }).id).toBe('c');
    });

    it('starts from the viewport without a current group', () => {
      expect(jump.pickJumpTarget(groups, 'next', { viewportTop: 300 }).id).toBe('b');
      expect(jump.pickJumpTarget(groups, 'previous', { viewportTop: 700 }).id).toBe('b');
    });

    it('treats a group sitting on the viewport top as already reached', () => {
      expect(jump.pickJumpTarget(groups, 'next', { viewportTop: 499 }).id).toBe('c');
      expect(jump.pickJumpTarget(groups, 'previous', { viewportTop: 501 }).id).toBe('a');
    });

    it('wraps from the viewport when nothing lies in that direction', () => {
      expect(jump.pickJumpTarget(groups, 'next', { viewportTop: 1000 }).id).toBe('a');
      expect(jump.pickJumpTarget(groups, 'previous', { viewportTop: 50 }).id).toBe('c');
    });

    it('ignores a current id that is no longer on the page', () => {
      expect(jump.pickJumpTarget(groups, 'next', { currentId: 'gone', viewportTop: 300 }).id).toBe('b');
    });
  });
});
