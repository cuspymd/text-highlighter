import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import '../content-scripts/content-core.js';
import {
  loadContentScripts,
  respondToBackground,
  respondToStorage,
  resetContentScriptEnvironment,
} from './helpers/content-script.js';

// Highlighting over existing highlights merges with them: the selection and
// every group it touches become one group in the new colour. This is the
// replacement for the old "overlap aborts" rule, which forced the user to
// delete a highlight before they could extend or recolour it.
describe('highlighting over existing highlights', () => {
  let page = null;
  let sent = [];

  async function loadContentScript() {
    sent = [];
    respondToBackground(message => {
      sent.push(message);
      if (message.action === 'getColors') return { colors: [] };
      if (message.action === 'getHighlights') return { highlights: [] };
      return { success: true };
    });
    respondToStorage({ minimapVisible: false });

    // controls.js owns these; without it loaded the content script reads them
    // off window.
    window.activeHighlightElement = null;
    window.highlightControlsContainer = null;

    page = loadContentScripts(['common', 'content']);
    await jest.advanceTimersByTimeAsync(600);
  }

  // Select `text` where it first appears in the page's text, across nodes.
  function selectText(text) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let full = '';
    let node;
    while (node = walker.nextNode()) {
      nodes.push({ node, start: full.length, end: full.length + node.nodeValue.length });
      full += node.nodeValue;
    }
    const start = full.indexOf(text);
    if (start === -1) throw new Error(`"${text}" not on the page`);
    const end = start + text.length;
    const startInfo = nodes.find(info => start >= info.start && start < info.end);
    const endInfo = nodes.find(info => end > info.start && end <= info.end);

    const range = document.createRange();
    range.setStart(startInfo.node, start - startInfo.start);
    range.setEnd(endInfo.node, end - endInfo.start);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function highlight(text, color) {
    selectText(text);
    window.highlightSelectedText(color);
  }

  function groupsOnPage() {
    const byGroup = new Map();
    document.querySelectorAll('.text-highlighter-extension').forEach(span => {
      const entry = byGroup.get(span.dataset.groupId) || { text: '', color: span.style.backgroundColor };
      entry.text += span.textContent;
      byGroup.set(span.dataset.groupId, entry);
    });
    return Array.from(byGroup.values());
  }

  function savedGroups() {
    return window.TextHighlighterState.get().highlights;
  }

  function lastSave() {
    return sent.filter(message => message.action === 'saveHighlights').at(-1);
  }

  // Clear the page and restore from what was saved, the way a reload does.
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

    // Group ids come from Date.now(); two highlights in one tick would share one.
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

  it('extends a highlight when the selection runs past it', async () => {
    document.body.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p>';
    await loadContentScript();
    highlight('brown fox', 'yellow');

    highlight('quick brown fox jumps', 'green');

    expect(groupsOnPage()).toEqual([{ text: 'quick brown fox jumps', color: 'green' }]);
    expect(savedGroups().map(group => group.text)).toEqual(['quick brown fox jumps']);
  });

  it('joins two highlights the selection spans, keeping the text between them', async () => {
    document.body.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p>';
    await loadContentScript();
    highlight('quick', 'yellow');
    highlight('lazy dog', 'yellow');

    highlight('uick brown fox jumps over the la', 'green');

    expect(groupsOnPage()).toEqual([{ text: 'quick brown fox jumps over the lazy dog', color: 'green' }]);
    expect(savedGroups()).toHaveLength(1);
  });

  it('recolours a highlight in place when the selection stays inside it', async () => {
    document.body.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p>';
    await loadContentScript();
    highlight('brown fox jumps', 'yellow');
    const [before] = savedGroups();

    highlight('fox', 'green');

    expect(groupsOnPage()).toEqual([{ text: 'brown fox jumps', color: 'green' }]);
    expect(savedGroups()).toHaveLength(1);
    expect(savedGroups()[0].groupId).toBe(before.groupId);
    expect(lastSave().deletedGroupIds).toBeUndefined();
  });

  it('merges across inline elements and a group split into several spans', async () => {
    document.body.innerHTML = '<p>The quick <b>brown fox</b> jumps over the <i>lazy</i> dog. The end.</p>';
    await loadContentScript();
    highlight('lazy dog', 'yellow');

    highlight('quick brown fox jumps over the lazy', 'green');

    expect(groupsOnPage()).toEqual([{ text: 'quick brown fox jumps over the lazy dog', color: 'green' }]);
    expect(document.body.textContent).toBe('The quick brown fox jumps over the lazy dog. The end.');
  });

  it('tells the background which groups the merge replaced, in the same save', async () => {
    document.body.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p>';
    await loadContentScript();
    highlight('quick', 'yellow');
    highlight('fox', 'yellow');
    const replaced = savedGroups().map(group => group.groupId);

    highlight('quick brown fox', 'green');

    expect(sent.filter(message => message.action === 'deleteHighlight')).toHaveLength(0);
    expect(lastSave().deletedGroupIds).toEqual(replaced);
    expect(lastSave().highlights.map(group => group.groupId)).not.toEqual(expect.arrayContaining(replaced));
  });

  it('leaves untouched highlights alone', async () => {
    document.body.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p>';
    await loadContentScript();
    highlight('quick', 'yellow');
    highlight('lazy dog', 'yellow');

    highlight('brown fox jumps', 'green');

    expect(groupsOnPage()).toEqual([
      { text: 'quick', color: 'yellow' },
      { text: 'brown fox jumps', color: 'green' },
      { text: 'lazy dog', color: 'yellow' },
    ]);
  });

  it('restores the merged highlight after a reload', async () => {
    document.body.innerHTML = '<p>Alpha brown fox jumps.</p><p>Beta brown fox jumps.</p><p>Gamma brown fox jumps.</p>';
    await loadContentScript();
    highlight('Beta brown', 'yellow');
    highlight('Gamma brown', 'yellow');

    highlight('Beta brown fox jumps', 'green');
    reload();

    expect(groupsOnPage()).toEqual([
      { text: 'Beta brown fox jumps', color: 'green' },
      { text: 'Gamma brown', color: 'yellow' },
    ]);
  });

  it('closes the controls if the merge swallowed the active highlight', async () => {
    document.body.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p>';
    await loadContentScript();
    highlight('brown fox', 'yellow');
    window.activeHighlightElement = document.querySelector('.text-highlighter-extension');

    highlight('quick brown fox jumps', 'green');

    expect(window.activeHighlightElement).toBeNull();
    expect(window.hideHighlightControls).toHaveBeenCalled();
  });
});
