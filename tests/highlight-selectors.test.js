import { jest } from '@jest/globals';
import '../content-scripts/content-core.js';
import {
  loadContentScripts,
  respondToBackground,
  respondToStorage,
  resetContentScriptEnvironment,
} from './helpers/content-script.js';

// The selector a new highlight saves is resolved, on restore, against a text
// model that includes every other highlight on the page. It has to be built
// against that same text, or its context has holes where the neighbours sit.
describe('selectors built next to other highlights', () => {
  let page = null;

  async function loadContentScript() {
    respondToBackground(message => {
      if (message.action === 'getColors') return { colors: [] };
      if (message.action === 'getHighlights') return { highlights: [] };
      return { success: true };
    });
    respondToStorage({ minimapVisible: false });
    window.activeHighlightElement = null;
    window.highlightControlsContainer = null;

    page = loadContentScripts(['common', 'content']);
    await jest.advanceTimersByTimeAsync(600);
  }

  // Select `text` inside the text node that contains it, skipping the first
  // `skip` occurrences.
  function selectText(text, skip = 0) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    let seen = 0;
    while (node = walker.nextNode()) {
      const index = node.nodeValue.indexOf(text);
      if (index === -1) continue;
      if (seen++ < skip) continue;

      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + text.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`"${text}" not found in one text node`);
  }

  function highlight(text, color, skip = 0) {
    selectText(text, skip);
    window.highlightSelectedText(color);
  }

  function savedGroups() {
    return window.TextHighlighterState.get().highlights;
  }

  function reload() {
    const saved = JSON.parse(JSON.stringify(savedGroups()));
    window.clearAllHighlights();
    document.body.normalize();
    window.TextHighlighterState.set({ highlights: saved });
    window.applyHighlights();
  }

  let originalRangeRect;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetContentScriptEnvironment();

    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now++);

    originalRangeRect = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = () => ({
      top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    Range.prototype.getBoundingClientRect = originalRangeRect;
  });

  it('keeps the neighbours in the prefix and suffix, as the restore will see them', async () => {
    document.body.innerHTML = '<p>The quick brown fox jumps over the lazy dog. The end.</p>';
    await loadContentScript();
    highlight('quick', 'yellow');
    highlight('lazy dog', 'yellow');

    highlight('fox jumps', 'green');

    const group = savedGroups().find(candidate => candidate.text === 'fox jumps');
    expect(group.selectors.quote.prefix).toBe('The quick brown ');
    expect(group.selectors.quote.suffix).toBe(' over the lazy dog. The end.'.slice(0, 24));
    expect(group.selectors.textPosition).toEqual({ start: 16, end: 25 });
  });

  it('restores a repeated phrase onto the occurrence that was highlighted', async () => {
    document.body.innerHTML =
      '<p>One: brown fox jumps.</p><p>Two: brown fox jumps.</p><p>Three: brown fox jumps.</p>';
    await loadContentScript();
    highlight('One', 'yellow');
    highlight('Two', 'yellow');
    highlight('Three', 'yellow');
    // The third paragraph's phrase, whose prefix would be all holes without
    // the neighbouring highlights in the model.
    highlight('brown fox jumps', 'green', 2);

    reload();

    const green = document.querySelectorAll('.text-highlighter-extension[style*="green"]');
    expect(green).toHaveLength(1);
    expect(green[0].closest('p').textContent).toBe('Three: brown fox jumps.');
  });
});
