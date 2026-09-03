import '../content-scripts/content-core.js';

// Browsers hand the highlighter element boundaries - `(p, 2)` for "after p's
// second child" - from triple-clicks, shift-clicks and selections that end
// right after an inline element. The highlighter reads boundaries as text
// offsets, so those have to be moved onto text nodes first, and the saved
// selector has to describe the same text the page shows.
describe('content-core range boundaries', () => {
  const core = window.TextHighlighterCore;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function paragraphs() {
    document.body.innerHTML =
      '<div>\n  <p>alpha <b>beta</b> gamma</p>\n  <p>see <a href="#">the docs</a></p>\n  <p>next para</p>\n</div>';
    return Array.from(document.querySelectorAll('p'));
  }

  function spanTexts(spans) {
    return spans.map(span => span.textContent);
  }

  describe('clampRangeToTextNodes', () => {
    it('leaves a range that already sits in text nodes alone', () => {
      const [p1] = paragraphs();
      const range = document.createRange();
      range.setStart(p1.firstChild, 1);
      range.setEnd(p1.lastChild, 3);

      expect(core.clampRangeToTextNodes(range)).toBe(range);
    });

    it('moves an end on an element onto the last selected text node', () => {
      const [p1, p2] = paragraphs();
      const range = document.createRange();
      range.setStart(p1.lastChild, 1);
      range.setEnd(p2, 2);

      const clamped = core.clampRangeToTextNodes(range);

      expect(clamped.endContainer).toBe(p2.querySelector('a').firstChild);
      expect(clamped.endOffset).toBe('the docs'.length);
      expect(clamped.toString().replace(/\s+/g, ' ')).toBe('gamma see the docs');
    });

    it('moves a start on an element onto the first selected text node', () => {
      const [p1, p2] = paragraphs();
      const range = document.createRange();
      range.setStart(p1, 2);
      range.setEnd(p2.firstChild, 3);

      const clamped = core.clampRangeToTextNodes(range);

      expect(clamped.startContainer).toBe(p1.lastChild);
      expect(clamped.startOffset).toBe(0);
      expect(clamped.toString().replace(/\s+/g, ' ')).toBe(' gamma see');
    });

    it('skips the whitespace between blocks when the end is the next block at offset 0', () => {
      const [p1, , p3] = paragraphs();
      const range = document.createRange();
      range.setStart(p1.firstChild, 0);
      range.setEnd(p3, 0);

      const clamped = core.clampRangeToTextNodes(range);

      expect(clamped.endContainer).toBe(document.querySelector('a').firstChild);
      expect(clamped.endOffset).toBe('the docs'.length);
    });
  });

  describe('processSelectionRange', () => {
    it('highlights the selected children of an element end boundary', () => {
      const [p1, p2] = paragraphs();
      const range = document.createRange();
      range.setStart(p1.lastChild, 1);
      range.setEnd(p2, 2);

      const spans = core.processSelectionRange(range, '#ff0', 'g');

      expect(spanTexts(spans)).toEqual(['gamma', 'see ', 'the docs']);
    });

    it('does not highlight the children before an element start boundary', () => {
      const [p1, p2] = paragraphs();
      const range = document.createRange();
      range.setStart(p1, 2);
      range.setEnd(p2.firstChild, 3);

      const spans = core.processSelectionRange(range, '#ff0', 'g');

      expect(spanTexts(spans)).toEqual([' gamma', 'see']);
    });
  });

  describe('rangeToTextPosition', () => {
    it('describes the text on screen for an element end boundary, not the raw selection length', () => {
      const [p1, p2] = paragraphs();
      const model = core.buildNormalizedTextModel(document.body);
      const range = document.createRange();
      range.setStart(p1.lastChild, 1);
      range.setEnd(p2, 2);

      const quote = core.buildQuoteSelector(model, range);

      expect(quote.exact).toBe('gamma see the docs');
    });

    it('starts the quote at the selection for an element start boundary', () => {
      const [p1, p2] = paragraphs();
      const model = core.buildNormalizedTextModel(document.body);
      const range = document.createRange();
      range.setStart(p1, 2);
      range.setEnd(p2.firstChild, 3);

      const quote = core.buildQuoteSelector(model, range);

      expect(quote.exact).toBe(' gamma see');
    });

    it('returns null when no text lies inside the boundaries', () => {
      document.body.innerHTML = '<div><p></p><p>later</p></div>';
      const [p1] = document.querySelectorAll('p');
      const model = core.buildNormalizedTextModel(document.body);
      const range = document.createRange();
      range.setStart(p1, 0);
      range.setEnd(p1, 0);

      expect(core.rangeToTextPosition(model, range)).toBeNull();
    });
  });
});
