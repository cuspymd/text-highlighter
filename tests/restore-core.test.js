import { jest } from '@jest/globals';
import '../content-scripts/content-core.js';
import '../content-scripts/restore-core.js';

describe('restore-core', () => {
  const core = window.TextHighlighterCore;
  const restore = window.TextHighlighterRestoreCore;

  describe('needsQuoteRestore', () => {
    it('accepts a group carrying a quote selector', () => {
      expect(restore.needsQuoteRestore({ selectors: { quote: { exact: 'hello' } } })).toBe(true);
    });

    it('rejects a legacy group that only has spans', () => {
      expect(restore.needsQuoteRestore({ spans: [{ text: 'hello' }] })).toBe(false);
    });

    it('rejects selectors without a quote', () => {
      expect(restore.needsQuoteRestore({ selectors: { textPosition: { start: 0, end: 5 } } })).toBe(false);
    });

    it('rejects nothing at all', () => {
      expect(restore.needsQuoteRestore(null)).toBe(false);
      expect(restore.needsQuoteRestore(undefined)).toBe(false);
    });
  });

  describe('overlapsClaimedRegion', () => {
    const claimed = [{ start: 10, end: 20 }];

    it('sees an overlap when the region starts inside a claim', () => {
      expect(restore.overlapsClaimedRegion(claimed, { start: 15, end: 25 })).toBe(true);
    });

    it('sees an overlap when the region ends inside a claim', () => {
      expect(restore.overlapsClaimedRegion(claimed, { start: 5, end: 15 })).toBe(true);
    });

    it('sees an overlap when the region swallows a claim', () => {
      expect(restore.overlapsClaimedRegion(claimed, { start: 0, end: 30 })).toBe(true);
    });

    it('lets a region that merely touches a claim through', () => {
      expect(restore.overlapsClaimedRegion(claimed, { start: 20, end: 30 })).toBe(false);
      expect(restore.overlapsClaimedRegion(claimed, { start: 0, end: 10 })).toBe(false);
    });

    it('lets anything through when nothing is claimed', () => {
      expect(restore.overlapsClaimedRegion([], { start: 0, end: 10 })).toBe(false);
    });
  });

  describe('maskClaimedRegions', () => {
    it('replaces the claimed span and leaves the rest alone', () => {
      const masked = restore.maskClaimedRegions('alpha beta gamma', [{ start: 6, end: 10 }]);

      expect(masked.slice(0, 6)).toBe('alpha ');
      expect(masked.slice(10)).toBe(' gamma');
      expect(masked).not.toContain('beta');
    });

    // Everything downstream indexes into this string, so a mask that changed its
    // length would move every offset past the first claim.
    it('keeps the text exactly as long as it was', () => {
      const text = 'alpha beta gamma';

      expect(restore.maskClaimedRegions(text, [{ start: 6, end: 10 }])).toHaveLength(text.length);
    });

    it('masks with a character the page text cannot contain', () => {
      const masked = restore.maskClaimedRegions('alpha beta', [{ start: 0, end: 5 }]);

      expect(masked.slice(0, 5)).toBe(restore.CLAIMED_REGION_FILLER.repeat(5));
      expect(restore.CLAIMED_REGION_FILLER.charCodeAt(0)).toBe(0);
    });

    it('masks every claim it is given', () => {
      const masked = restore.maskClaimedRegions('alpha beta gamma', [
        { start: 0, end: 5 },
        { start: 11, end: 16 },
      ]);

      expect(masked).toContain('beta');
      expect(masked).not.toContain('alpha');
      expect(masked).not.toContain('gamma');
    });

    it('clamps a claim that runs off either end', () => {
      const masked = restore.maskClaimedRegions('alpha', [{ start: -5, end: 99 }]);

      expect(masked).toBe(restore.CLAIMED_REGION_FILLER.repeat(5));
    });

    // split('') keeps one entry per UTF-16 code unit, which is what the offsets
    // coming out of the model are counted in. Array.from would group surrogate
    // pairs and misalign every offset past the first emoji.
    it('counts a surrogate pair the way the model offsets do', () => {
      const text = 'a\u{1F600}b';
      const masked = restore.maskClaimedRegions(text, [{ start: 3, end: 4 }]);

      expect(masked).toHaveLength(text.length);
      expect(masked.slice(0, 3)).toBe('a\u{1F600}');
      expect(masked.slice(3)).toBe(restore.CLAIMED_REGION_FILLER);
    });

    it('returns the text untouched when nothing is claimed', () => {
      expect(restore.maskClaimedRegions('alpha beta', [])).toBe('alpha beta');
    });
  });

  describe('isRangeInDocument', () => {
    beforeEach(() => {
      document.body.innerHTML = '<p>alpha beta</p>';
    });

    it('accepts a range over nodes that are on the page', () => {
      const node = document.querySelector('p').firstChild;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 5);

      expect(restore.isRangeInDocument(range)).toBe(true);
    });

    // A range built from a stale model points at a node the page no longer
    // holds. Highlighting one of those silently succeeds against the orphan, so
    // it has to be caught before the range is applied rather than after.
    //
    // The removal has to come before the range is built: taking a node out of
    // the document moves any range already inside it up to the parent, which is
    // still connected.
    it('rejects a range over a node the page does not hold', () => {
      const detached = document.querySelector('p');
      detached.remove();

      const range = document.createRange();
      range.setStart(detached.firstChild, 0);
      range.setEnd(detached.firstChild, 5);

      expect(restore.isRangeInDocument(range)).toBe(false);
    });

    it('rejects nothing at all', () => {
      expect(restore.isRangeInDocument(null)).toBe(false);
    });
  });

  describe('resolveUnclaimedMatch', () => {
    function modelFor(html) {
      document.body.innerHTML = html;
      return core.buildNormalizedTextModel(document.body, { includeHighlightedText: true });
    }

    function quoteGroupFor(model, exact, occurrence = 0) {
      let start = -1;
      for (let i = 0; i <= occurrence; i++) {
        start = model.text.indexOf(exact, start + 1);
      }
      const end = start + exact.length;
      const range = core.normalizedOffsetsToRange(model, start, end);

      return {
        text: exact,
        selectors: {
          quote: core.buildQuoteSelector(model, range, { prefixLen: 20, suffixLen: 20 }),
          textPosition: { start, end },
        },
      };
    }

    it('resolves a group against unclaimed text', () => {
      const model = modelFor('<p>Opening line with a phrase inside.</p>');
      const group = quoteGroupFor(model, 'a phrase');

      const match = restore.resolveUnclaimedMatch(core, model, group, []);

      expect(model.text.slice(match.start, match.end)).toBe('a phrase');
    });

    // Two groups saved on the same phrase resolve to the same occurrence on the
    // first try. The second has to land on the other one, not give up.
    it('sends the second group to the other occurrence of a repeated phrase', () => {
      const model = modelFor(
        '<p>Opening line with shared phrase inside it.</p>' +
        '<p>Closing line with shared phrase inside it.</p>'
      );
      const first = quoteGroupFor(model, 'shared phrase', 0);

      const firstMatch = restore.resolveUnclaimedMatch(core, model, first, []);
      const secondMatch = restore.resolveUnclaimedMatch(core, model, first, [firstMatch]);

      expect(secondMatch).not.toBeNull();
      expect(secondMatch.start).not.toBe(firstMatch.start);
      expect(model.text.slice(secondMatch.start, secondMatch.end)).toBe('shared phrase');
    });

    it('gives up when every occurrence is already claimed', () => {
      const model = modelFor('<p>Opening line with a phrase inside.</p>');
      const group = quoteGroupFor(model, 'a phrase');
      const only = restore.resolveUnclaimedMatch(core, model, group, []);

      expect(restore.resolveUnclaimedMatch(core, model, group, [only])).toBeNull();
    });

    it('returns null when the text is not on the page at all', () => {
      const model = modelFor('<p>Opening line.</p>');
      const group = {
        text: 'nowhere to be found',
        selectors: {
          quote: { exact: 'nowhere to be found', prefix: '', suffix: '' },
          textPosition: { start: 0, end: 19 },
        },
      };

      expect(restore.resolveUnclaimedMatch(core, model, group, [])).toBeNull();
    });

    it('falls back to the group text when the selector carries no exact', () => {
      const model = modelFor('<p>Opening line with a phrase inside.</p>');
      const group = {
        text: 'a phrase',
        selectors: {
          quote: { exact: '', prefix: '', suffix: '' },
          textPosition: { start: 0, end: 8 },
        },
      };

      const match = restore.resolveUnclaimedMatch(core, model, group, []);

      expect(model.text.slice(match.start, match.end)).toBe('a phrase');
    });
  });

  describe('createRestorePendingState', () => {
    let now;

    beforeEach(() => {
      now = 1_000_000;
    });

    function makeState(recheckMs = 300) {
      return restore.createRestorePendingState({ recheckMs, now: () => now });
    }

    // On a fresh page a restore always is coming, and the popup can open before
    // the page has even asked for its highlights.
    it('starts pending, so an early question is not answered "done"', () => {
      const state = makeState();

      expect(state.isPending).toBe(true);
      expect(state.remainingMs()).toBe(300);
    });

    it('reports the time left until the queued pass is due', () => {
      const state = makeState();
      state.mark(1500);

      expect(state.remainingMs()).toBe(1500);

      now += 1000;
      expect(state.remainingMs()).toBe(500);
    });

    // Past the deadline what is left is a message round trip of unknown length,
    // so the answer becomes "ask again shortly" rather than "done".
    it('falls back to the recheck interval once the deadline passes', () => {
      const state = makeState();
      state.mark(1500);
      now += 5000;

      expect(state.remainingMs()).toBe(300);
      expect(state.isPending).toBe(true);
    });

    it('reports zero once the pass has actually run', () => {
      const state = makeState();
      state.mark(1500);
      state.clear();

      expect(state.isPending).toBe(false);
      expect(state.remainingMs()).toBe(0);
    });

    // Two passes in flight finish no sooner than the later one, so a second
    // mark must never pull the deadline in.
    it('keeps the later of two deadlines', () => {
      const state = makeState();
      state.mark(2000);
      state.mark(500);

      expect(state.remainingMs()).toBe(2000);
    });

    it('extends the deadline when the later mark is further out', () => {
      const state = makeState();
      state.mark(500);
      state.mark(2000);

      expect(state.remainingMs()).toBe(2000);
    });

    it('starts a fresh deadline after a clear', () => {
      const state = makeState();
      state.mark(5000);
      state.clear();
      state.mark(1000);

      expect(state.remainingMs()).toBe(1000);
    });

    it('honours the recheck interval the caller asked for', () => {
      const state = makeState(50);
      state.mark(10);
      now += 1000;

      expect(state.remainingMs()).toBe(50);
    });

    it('keeps two states independent of each other', () => {
      const first = makeState();
      const second = makeState();

      first.clear();

      expect(first.isPending).toBe(false);
      expect(second.isPending).toBe(true);
    });
  });
});
