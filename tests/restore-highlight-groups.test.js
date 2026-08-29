import fs from 'fs';
import '../content-scripts/content-core.js';

const contentSource = fs.readFileSync(new URL('../content-scripts/content.js', import.meta.url), 'utf8');

describe('restoring highlight groups', () => {
  const core = window.TextHighlighterCore;

  function loadContentScript() {
    window.debugLog = jest.fn();
    window.hideHighlightControls = jest.fn();
    window.createHighlightControls = jest.fn();
    window.refreshHighlightControlsColors = jest.fn();
    window.setSelectionControlsVisibility = jest.fn();
    window.MinimapManager = jest.fn(() => ({
      init: jest.fn(),
      setVisibility: jest.fn(),
      updateMarkers: jest.fn(),
    }));

    global.browserAPI = {
      runtime: {
        sendMessage: jest.fn((message, callback) => {
          if (!callback) return;
          if (message.action === 'getColors') return callback({ colors: [] });
          if (message.action === 'getHighlights') return callback({ highlights: [] });
          callback({ success: true });
        }),
        getURL: jest.fn(() => 'chrome-extension://test/content-scripts/navigation-bridge.js'),
        onMessage: { addListener: jest.fn() },
      },
      storage: {
        local: { get: jest.fn((keys, callback) => callback({ minimapVisible: false })) },
      },
    };

    window.eval(contentSource);
  }

  // Build a group the way the extension saves one, anchored to the nth
  // occurrence of `exactText` in the current document.
  function makeGroup(groupId, exactText, occurrence = 0) {
    const model = core.buildNormalizedTextModel(document.body);

    let start = -1;
    for (let i = 0; i <= occurrence; i++) {
      start = model.text.indexOf(exactText, start + 1);
    }
    if (start === -1) throw new Error(`"${exactText}" not found in page text`);
    const end = start + exactText.length;

    const range = core.normalizedOffsetsToRange(model, start, end);
    const quote = core.buildQuoteSelector(model, range, { prefixLen: 20, suffixLen: 20 });

    return {
      groupId,
      color: '#ffff00',
      text: exactText,
      selectors: { quote, textPosition: { start, end } },
      spans: [{ text: exactText, position: 0 }],
    };
  }

  function restore(groups) {
    window.TextHighlighterState.set({ highlights: groups });
    window.applyHighlights();
  }

  function highlightedTextFor(groupId) {
    return Array.from(document.querySelectorAll(`.text-highlighter-extension[data-group-id="${groupId}"]`))
      .map(span => span.textContent)
      .join('');
  }

  // jsdom does not implement Range.getBoundingClientRect, which the legacy span
  // restore uses to pick the candidate closest to the saved position. Geometry
  // is irrelevant here, so a flat zero rect is enough to exercise the path.
  let originalRangeRect;

  beforeEach(() => {
    jest.useFakeTimers();
    document.head.innerHTML = '';
    document.body.innerHTML = '';

    originalRangeRect = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = () => ({
      top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
    });
  });

  afterEach(() => {
    jest.useRealTimers();

    if (originalRangeRect) {
      Range.prototype.getBoundingClientRect = originalRangeRect;
    } else {
      delete Range.prototype.getBoundingClientRect;
    }
  });

  it('builds the normalized text model once no matter how many groups restore', () => {
    document.body.innerHTML =
      '<p>Alpha one</p><p>Beta two</p><p>Gamma three</p><p>Delta four</p><p>Epsilon five</p>';

    const groups = [
      makeGroup('g1', 'Alpha one'),
      makeGroup('g2', 'Beta two'),
      makeGroup('g3', 'Gamma three'),
      makeGroup('g4', 'Delta four'),
      makeGroup('g5', 'Epsilon five'),
    ];

    loadContentScript();
    const buildSpy = jest.spyOn(core, 'buildNormalizedTextModel');

    try {
      restore(groups);

      expect(buildSpy).toHaveBeenCalledTimes(1);
      groups.forEach(group => {
        expect(highlightedTextFor(group.groupId)).toBe(group.text);
      });
    } finally {
      buildSpy.mockRestore();
    }
  });

  it('places every group correctly when stored order does not match document order', () => {
    document.body.innerHTML =
      '<p>The quick brown fox</p><p>jumps over the lazy dog</p><p>near the river bank</p>';

    const groups = [
      makeGroup('last', 'river bank'),
      makeGroup('first', 'quick brown'),
      makeGroup('middle', 'lazy dog'),
    ];

    loadContentScript();
    restore(groups);

    expect(highlightedTextFor('first')).toBe('quick brown');
    expect(highlightedTextFor('middle')).toBe('lazy dog');
    expect(highlightedTextFor('last')).toBe('river bank');
  });

  it('gives two groups on the same phrase separate occurrences', () => {
    document.body.innerHTML =
      '<p id="first">Opening line with shared phrase inside it.</p>' +
      '<p id="second">Closing line with shared phrase inside it.</p>';

    const groups = [
      makeGroup('a', 'shared phrase', 0),
      makeGroup('b', 'shared phrase', 1),
    ];

    loadContentScript();
    restore(groups);

    const spans = document.querySelectorAll('.text-highlighter-extension');
    expect(spans).toHaveLength(2);

    const byParagraph = Array.from(spans).map(span => ({
      groupId: span.dataset.groupId,
      paragraph: span.closest('p').id,
    }));

    expect(byParagraph.map(entry => entry.paragraph).sort()).toEqual(['first', 'second']);
    expect(new Set(byParagraph.map(entry => entry.groupId)).size).toBe(2);
  });

  it('falls back to legacy spans when the quote selector no longer resolves', () => {
    document.body.innerHTML = '<p>Surviving sentence stays put.</p>';

    const group = makeGroup('legacy', 'Surviving sentence');
    // Simulate an edit that moved the surrounding text: the exact quote is gone,
    // but the span text the older format recorded is still on the page.
    group.selectors.quote.exact = 'Text that is no longer present';
    group.text = 'Text that is no longer present';
    group.spans = [{ text: 'Surviving sentence', position: 0 }];

    loadContentScript();
    restore([group]);

    expect(highlightedTextFor('legacy')).toBe('Surviving sentence');
  });

  it('leaves nothing highlighted when neither the quote nor the legacy spans match', () => {
    document.body.innerHTML = '<p>Anchor text for selector building.</p>';
    const group = makeGroup('gone', 'Anchor text');

    // The page the highlight was saved on is gone entirely.
    document.body.innerHTML = '<p>Completely different content.</p>';

    loadContentScript();
    restore([group]);

    expect(document.querySelectorAll('.text-highlighter-extension')).toHaveLength(0);
  });
});
