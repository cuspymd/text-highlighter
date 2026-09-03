import '../content-scripts/content-core.js';

// The two questions a merge asks of the page: which groups does a selection
// touch, and what stretch of page text does each of them cover.
describe('content-core merge regions', () => {
  const core = window.TextHighlighterCore;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function highlightSpan(groupId, text) {
    const span = document.createElement('span');
    span.className = 'text-highlighter-extension';
    span.dataset.groupId = groupId;
    span.textContent = text;
    return span;
  }

  it('names every group the range touches, once each', () => {
    const p = document.createElement('p');
    p.append('The ', highlightSpan('a', 'quick'), ' brown ', highlightSpan('b', 'fox'), ' jumps ', highlightSpan('b', 'over'), ' it');
    document.body.appendChild(p);

    const range = document.createRange();
    range.setStart(p.firstChild, 2);
    range.setEnd(p.childNodes[4], 3);

    expect(Array.from(core.overlappingHighlightGroupIds(range))).toEqual(['a', 'b']);
  });

  it('names no group for a selection between highlights', () => {
    const p = document.createElement('p');
    p.append('The ', highlightSpan('a', 'quick'), ' brown ', highlightSpan('b', 'fox'));
    document.body.appendChild(p);

    const range = document.createRange();
    range.setStart(p.childNodes[2], 1);
    range.setEnd(p.childNodes[2], 6);

    expect(core.overlappingHighlightGroupIds(range).size).toBe(0);
  });

  it('measures a group from its first span to its last, including the gap between them', () => {
    const p = document.createElement('p');
    p.append('The ', highlightSpan('b', 'fox'), ' jumps ', highlightSpan('b', 'over'), ' it');
    document.body.appendChild(p);
    const model = core.buildNormalizedTextModel(document.body, { includeHighlightedText: true });

    const region = core.highlightGroupTextRegion(model, Array.from(p.querySelectorAll('span')));

    expect(model.text.substring(region.start, region.end)).toBe('fox jumps over');
  });

  it('returns null for a group with no spans', () => {
    const model = core.buildNormalizedTextModel(document.body, { includeHighlightedText: true });

    expect(core.highlightGroupTextRegion(model, [])).toBeNull();
  });
});
