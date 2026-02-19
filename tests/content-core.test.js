import '../content-scripts/content-core.js';

describe('content-core', () => {
  const core = window.TextHighlighterCore;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('converts range when common ancestor equals start container', () => {
    const p = document.createElement('p');
    const first = document.createTextNode('First');
    const second = document.createTextNode('Second');
    p.appendChild(first);
    p.appendChild(document.createElement('br'));
    p.appendChild(second);
    document.body.appendChild(p);

    const range = document.createRange();
    range.setStart(p, 0);
    range.setEnd(second, 3);

    const converted = core.convertSelectionRange(range);
    expect(converted.startContainer).toBe(first);
    expect(converted.startOffset).toBe(0);
    expect(converted.endContainer).toBe(second);
    expect(converted.endOffset).toBe(3);
  });

  it('returns original range when conversion condition does not match', () => {
    const p = document.createElement('p');
    const text = document.createTextNode('Hello world');
    p.appendChild(text);
    document.body.appendChild(p);

    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 5);

    const converted = core.convertSelectionRange(range);
    expect(converted).toBe(range);
  });

  it('processes single-node selection and creates one highlight span', () => {
    const p = document.createElement('p');
    const text = document.createTextNode('abcdef');
    p.appendChild(text);
    document.body.appendChild(p);

    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 4);

    const spans = core.processSelectionRange(range, '#ffff00', 'g1');
    expect(spans).toHaveLength(1);
    expect(spans[0].textContent).toBe('bcd');
    expect(spans[0].dataset.groupId).toBe('g1');
  });

  it('builds highlight group with span contract fields', () => {
    const span1 = document.createElement('span');
    span1.textContent = 'alpha';
    const span2 = document.createElement('span');
    span2.textContent = 'beta';

    const group = core.buildHighlightGroup({
      groupId: 'group-1',
      color: '#ff0',
      selectedText: 'alpha beta',
      highlightSpans: [span1, span2],
      getSpanPosition: (span) => (span.textContent === 'alpha' ? 100 : 200),
    });

    expect(group.groupId).toBe('group-1');
    expect(group.color).toBe('#ff0');
    expect(group.text).toBe('alpha beta');
    expect(group.spans).toEqual([
      { spanId: 'group-1_0', text: 'alpha', position: 100 },
      { spanId: 'group-1_1', text: 'beta', position: 200 },
    ]);
    expect(span1.dataset.spanId).toBe('group-1_0');
    expect(span2.dataset.spanId).toBe('group-1_1');
  });

  it('detects overlap with existing highlight elements', () => {
    const p = document.createElement('p');
    const highlight = document.createElement('span');
    highlight.className = 'text-highlighter-extension';
    highlight.textContent = 'hello';
    p.appendChild(highlight);
    document.body.appendChild(p);

    const textNode = highlight.firstChild;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);

    expect(core.selectionOverlapsHighlight(range)).toBe(true);
  });
});
