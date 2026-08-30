import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import '../content-scripts/content-core.js';
import {
  loadContentScripts,
  respondToBackground,
  respondToStorage,
  resetContentScriptEnvironment,
} from './helpers/content-script.js';

describe('restoring highlight groups', () => {
  const core = window.TextHighlighterCore;

  let page = null;

  // A round trip the background never answers: the promise simply never
  // settles, which is what a service worker still waking up looks like.
  function neverAnswers() {
    return new Promise(() => {});
  }

  // `getHighlights` defaults to an empty list. Tests that drive timers pass
  // `{}` instead, so the content script's own deferred load cannot call
  // applyHighlights again and reset the state under test.
  // `deferColors` / `deferHighlights` leave one of the two round trips on the
  // path to the first restore unanswered, standing in for a cold service worker.
  // `failColors` answers the first one in the shape that rejects.
  async function loadContentScript({
    highlightsResponse = { highlights: [] },
    deferColors = false,
    deferHighlights = false,
    failColors = false,
  } = {}) {
    respondToBackground(message => {
      if (message.action === 'getColors') {
        if (deferColors) return neverAnswers();
        return failColors ? {} : { colors: [] };
      }
      if (message.action === 'getHighlights') {
        if (deferHighlights) return neverAnswers();
        return highlightsResponse;
      }
      return { success: true };
    });
    respondToStorage({ minimapVisible: false });

    page = loadContentScripts(['common', 'content']);

    // The colours round trip is a promise now, so let it settle here: the
    // deferred load it schedules has to exist before a test advances timers.
    await jest.advanceTimersByTimeAsync(0);
  }

  // Deliver a message the way the background or the popup would.
  function sendToContentScript(message) {
    return page.sendToContentScript(message);
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

  // A group whose text is not on the page yet, standing in for content that
  // loads after the initial restore has already run.
  function lateGroup(groupId, exactText) {
    return {
      groupId,
      color: '#ffff00',
      text: exactText,
      selectors: {
        quote: { exact: exactText, prefix: '', suffix: '' },
        textPosition: { start: 0, end: exactText.length },
      },
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
    page = null;
    jest.clearAllMocks();
    resetContentScriptEnvironment();
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

  it('builds the normalized text model once no matter how many groups restore', async () => {
    document.body.innerHTML =
      '<p>Alpha one</p><p>Beta two</p><p>Gamma three</p><p>Delta four</p><p>Epsilon five</p>';

    const groups = [
      makeGroup('g1', 'Alpha one'),
      makeGroup('g2', 'Beta two'),
      makeGroup('g3', 'Gamma three'),
      makeGroup('g4', 'Delta four'),
      makeGroup('g5', 'Epsilon five'),
    ];

    await loadContentScript();
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

  it('places every group correctly when stored order does not match document order', async () => {
    document.body.innerHTML =
      '<p>The quick brown fox</p><p>jumps over the lazy dog</p><p>near the river bank</p>';

    const groups = [
      makeGroup('last', 'river bank'),
      makeGroup('first', 'quick brown'),
      makeGroup('middle', 'lazy dog'),
    ];

    await loadContentScript();
    restore(groups);

    expect(highlightedTextFor('first')).toBe('quick brown');
    expect(highlightedTextFor('middle')).toBe('lazy dog');
    expect(highlightedTextFor('last')).toBe('river bank');
  });

  it('gives two groups on the same phrase separate occurrences', async () => {
    document.body.innerHTML =
      '<p id="first">Opening line with shared phrase inside it.</p>' +
      '<p id="second">Closing line with shared phrase inside it.</p>';

    const groups = [
      makeGroup('a', 'shared phrase', 0),
      makeGroup('b', 'shared phrase', 1),
    ];

    await loadContentScript();
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

  // Highlighting rebuilds a text node instead of splitting it, so applying one
  // match detaches the node any other match in that node was resolved against.
  describe('multiple groups inside a single text node', () => {
    it('restores both when the groups carry no legacy spans to fall back on', async () => {
      document.body.innerHTML = '<p>alpha marker and later beta marker in one node.</p>';

      const groups = [makeGroup('g1', 'alpha marker'), makeGroup('g2', 'beta marker')];
      groups.forEach(group => { delete group.spans; });

      await loadContentScript();
      restore(groups);

      expect(highlightedTextFor('g1')).toBe('alpha marker');
      expect(highlightedTextFor('g2')).toBe('beta marker');
      expect(document.querySelectorAll('.text-highlighter-extension')).toHaveLength(2);
    });

    it('restores three groups sharing one text node', async () => {
      document.body.innerHTML = '<p>first mark then second mark then third mark done.</p>';

      const groups = [
        makeGroup('a', 'first mark'),
        makeGroup('b', 'second mark'),
        makeGroup('c', 'third mark'),
      ];
      groups.forEach(group => { delete group.spans; });

      await loadContentScript();
      restore(groups);

      expect(highlightedTextFor('a')).toBe('first mark');
      expect(highlightedTextFor('b')).toBe('second mark');
      expect(highlightedTextFor('c')).toBe('third mark');
    });

    it('rebuilds the model only for the groups that actually collide', async () => {
      document.body.innerHTML =
        '<p>alpha marker and later beta marker in one node.</p>' +
        '<p>Separate paragraph one</p><p>Separate paragraph two</p>';

      const groups = [
        makeGroup('g1', 'alpha marker'),
        makeGroup('g2', 'beta marker'),
        makeGroup('g3', 'Separate paragraph one'),
        makeGroup('g4', 'Separate paragraph two'),
      ];

      await loadContentScript();
      const buildSpy = jest.spyOn(core, 'buildNormalizedTextModel');

      try {
        restore(groups);

        groups.forEach(group => {
          expect(highlightedTextFor(group.groupId)).toBe(group.text);
        });
        // One build for the pass, plus one for the single colliding match.
        expect(buildSpy).toHaveBeenCalledTimes(2);
      } finally {
        buildSpy.mockRestore();
      }
    });
  });

  it('falls back to legacy spans when the quote selector no longer resolves', async () => {
    document.body.innerHTML = '<p>Surviving sentence stays put.</p>';

    const group = makeGroup('legacy', 'Surviving sentence');
    // Simulate an edit that moved the surrounding text: the exact quote is gone,
    // but the span text the older format recorded is still on the page.
    group.selectors.quote.exact = 'Text that is no longer present';
    group.text = 'Text that is no longer present';
    group.spans = [{ text: 'Surviving sentence', position: 0 }];

    await loadContentScript();
    restore([group]);

    expect(highlightedTextFor('legacy')).toBe('Surviving sentence');
  });

  it('resolves each ancestor only once during a legacy span restore', async () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) => `<p>Line ${i}</p>`).join('');
    document.body.innerHTML = `<div id="a"><div id="b"><div id="c">${paragraphs}</div></div></div>`;

    // No selectors at all, so this group skips the quote pass (and its text
    // model) and goes straight to the legacy DOM search.
    const group = {
      groupId: 'legacy-only',
      color: '#ffff00',
      text: 'Line 19',
      spans: [{ text: 'Line 19', position: 0 }],
    };

    await loadContentScript();
    const styleSpy = jest.spyOn(window, 'getComputedStyle');

    try {
      restore([group]);

      expect(highlightedTextFor('legacy-only')).toBe('Line 19');

      const resolved = styleSpy.mock.calls.map(call => call[0]);
      // 20 <p> ancestors plus the three shared wrappers, each resolved once.
      expect(resolved).toHaveLength(23);
      expect(new Set(resolved).size).toBe(23);
    } finally {
      styleSpy.mockRestore();
    }
  });

  describe('batched legacy restores', () => {
    function legacyGroup(groupId, ...texts) {
      return {
        groupId,
        color: '#ffff00',
        text: texts.join(''),
        spans: texts.map(text => ({ text, position: 0 })),
      };
    }

    it('walks the document once for a batch of unplaceable groups', async () => {
      const paragraphs = Array.from({ length: 20 }, (_, i) => `<p>Line ${i}</p>`).join('');
      document.body.innerHTML = `<div id="a"><div id="b"><div id="c">${paragraphs}</div></div></div>`;

      const groups = Array.from({ length: 8 }, (_, i) => legacyGroup(`miss${i}`, `absent text ${i}`));

      await loadContentScript();
      const styleSpy = jest.spyOn(window, 'getComputedStyle');

      try {
        restore(groups);

        expect(document.querySelectorAll('.text-highlighter-extension')).toHaveLength(0);

        // None of these groups touches the DOM, so the collected node list stays
        // valid: one walk over 23 elements for the whole batch, not one each.
        const resolved = styleSpy.mock.calls.map(call => call[0]);
        expect(resolved).toHaveLength(23);
      } finally {
        styleSpy.mockRestore();
      }
    });

    it('still places every group when the batch does mutate the document', async () => {
      document.body.innerHTML =
        '<p>first legacy target</p><p>second legacy target</p><p>third legacy target</p>';

      const groups = [
        legacyGroup('l1', 'first legacy'),
        legacyGroup('l2', 'second legacy'),
        legacyGroup('l3', 'third legacy'),
      ];

      await loadContentScript();
      restore(groups);

      expect(highlightedTextFor('l1')).toBe('first legacy');
      expect(highlightedTextFor('l2')).toBe('second legacy');
      expect(highlightedTextFor('l3')).toBe('third legacy');
    });

    it('drops the shared list when a group mutates the document and then fails', async () => {
      document.body.innerHTML = '<p>alpha beta gamma delta</p>';

      const groups = [
        // 'alpha' is wrapped before 'never-here' turns the group into a failure,
        // so the DOM changed even though the group reports failure.
        legacyGroup('partial', 'alpha', 'never-here'),
        legacyGroup('after', 'gamma'),
      ];

      await loadContentScript();
      restore(groups);

      expect(highlightedTextFor('after')).toBe('gamma');
      expect(document.querySelector('[data-group-id="after"]').isConnected).toBe(true);
    });

    it('rolls back the spans of a group that fails partway through', async () => {
      document.body.innerHTML = '<p>alpha beta gamma delta</p>';

      await loadContentScript();
      restore([legacyGroup('partial', 'alpha', 'never-here')]);

      // 'alpha' was wrapped before the group turned into a failure. Leaving that
      // span behind would report the group as restored and hide 'alpha' from the
      // next restore's walker.
      expect(document.querySelectorAll('.text-highlighter-extension')).toHaveLength(0);
      expect(document.querySelector('p').textContent).toBe('alpha beta gamma delta');
      expect(document.querySelector('p').childNodes).toHaveLength(1);
    });

    it('does not report a group that failed partway through as restored', async () => {
      document.body.innerHTML = '<p>alpha beta gamma delta</p>';

      await loadContentScript({ highlightsResponse: {} });
      restore([legacyGroup('partial', 'alpha', 'never-here')]);

      let response;
      page.messageListener({ action: 'getRestoredGroupIds' }, {}, value => { response = value; });
      expect(response.groupIds).toEqual([]);
    });

    it('retries a partially applied group against its own first span', async () => {
      document.body.innerHTML = '<p>alpha beta</p>';

      await loadContentScript({ highlightsResponse: {} });
      // 'omega' is not on the page yet, so this group fails after wrapping
      // 'alpha'. A leftover span there would hide the only 'alpha' from the
      // retry's walker, which would then either find nothing or, on a page with
      // a second 'alpha', anchor the group to the wrong one.
      restore([legacyGroup('partial', 'alpha', 'omega')]);
      expect(document.querySelectorAll('.text-highlighter-extension')).toHaveLength(0);

      document.body.innerHTML += '<p>omega arrives late</p>';
      await jest.advanceTimersByTimeAsync(1500);

      expect(highlightedTextFor('partial')).toBe('alphaomega');
    });
  });

  describe('delayed retry', () => {
    it('restores a group whose text only appears after the initial pass', async () => {
      document.body.innerHTML = '<p>Only this paragraph exists so far.</p>';

      await loadContentScript({ highlightsResponse: {} });
      restore([lateGroup('late', 'Late content')]);

      expect(document.querySelectorAll('.text-highlighter-extension')).toHaveLength(0);

      document.body.innerHTML += '<p>Late content arrives.</p>';
      await jest.advanceTimersByTimeAsync(1500);

      expect(highlightedTextFor('late')).toBe('Late content');
    });

    it('retries once and no more, even if the text turns up later still', async () => {
      document.body.innerHTML = '<p>Only this paragraph exists so far.</p>';

      await loadContentScript({ highlightsResponse: {} });
      restore([lateGroup('late', 'Late content')]);

      // The one retry fires while the text is still missing.
      await jest.advanceTimersByTimeAsync(1500);
      expect(document.querySelectorAll('.text-highlighter-extension')).toHaveLength(0);

      document.body.innerHTML += '<p>Late content arrives far too late.</p>';
      await jest.advanceTimersByTimeAsync(60000);

      expect(document.querySelectorAll('.text-highlighter-extension')).toHaveLength(0);
    });

    it('schedules nothing when every group restored', async () => {
      document.body.innerHTML = '<p>Present content is here.</p>';

      await loadContentScript({ highlightsResponse: {} });

      // The page's own deferred first load is already queued by now. The
      // question is whether a fully successful restore adds a retry on top.
      const queuedBeforeRestore = jest.getTimerCount();

      restore([makeGroup('ok', 'Present content')]);

      expect(highlightedTextFor('ok')).toBe('Present content');
      expect(jest.getTimerCount()).toBe(queuedBeforeRestore);
    });

    it('resolves a retried group against the text the page had before restoring', async () => {
      // Two occurrences of the same word. The saved selector tells them apart by
      // the words on either side of the second one - words that are themselves
      // highlighted by the time the retry runs.
      document.body.innerHTML =
        '<p>note TARGET here highlighted phrase TARGET trailing words end</p>';

      const before = makeGroup('before', 'highlighted phrase');
      const after = makeGroup('after', 'trailing words');
      const late = makeGroup('late', 'TARGET', 1);

      // The page the restore actually starts from: the TARGETs have not loaded.
      document.body.innerHTML = '<p>note here highlighted phrase trailing words end</p>';

      await loadContentScript({ highlightsResponse: {} });
      restore([before, after, late]);

      expect(highlightedTextFor('before')).toBe('highlighted phrase');
      expect(highlightedTextFor('after')).toBe('trailing words');
      expect(highlightedTextFor('late')).toBe('');

      // The late content arrives around the two highlights already applied.
      const paragraph = document.querySelector('p');
      paragraph.firstChild.nodeValue = 'note TARGET here ';
      paragraph.childNodes[2].nodeValue = ' TARGET ';
      await jest.advanceTimersByTimeAsync(1500);

      const placed = document.querySelector('[data-group-id="late"]');
      expect(placed).not.toBeNull();

      // It has to land on the second TARGET, the one the selector was built for.
      const upToSpan = document.createRange();
      upToSpan.setStart(paragraph, 0);
      upToSpan.setEndBefore(placed);
      expect(upToSpan.toString().split('TARGET')).toHaveLength(2);
    });

    it('drops a pending retry when the page navigates', async () => {
      document.body.innerHTML = '<p>Only this paragraph exists so far.</p>';

      await loadContentScript({ highlightsResponse: {} });
      restore([lateGroup('late', 'Late content')]);

      // The retry is queued against the previous URL's groups, so navigating
      // away has to cancel it rather than let it apply here.
      window.location.hash = '#next';
      window.dispatchEvent(new MessageEvent('message', {
        source: window,
        data: {
          source: 'text-highlighter-navigation-bridge',
          type: 'location-changed',
          href: window.location.href,
          trigger: 'test',
        },
      }));

      document.body.innerHTML += '<p>Late content arrives.</p>';
      await jest.advanceTimersByTimeAsync(60000);

      expect(document.querySelectorAll('.text-highlighter-extension')).toHaveLength(0);
    });
  });

  describe('popup retry messages', () => {
    function send(message) {
      let response;
      page.messageListener(message, {}, value => { response = value; });
      return response;
    }

    it('reports which groups are actually on the page', async () => {
      document.body.innerHTML = '<p>Present content is here.</p>';

      await loadContentScript({ highlightsResponse: {} });
      restore([makeGroup('ok', 'Present content')]);

      expect(send({ action: 'getRestoredGroupIds' })).toEqual({
        success: true,
        groupIds: ['ok'],
        pendingRestoreMs: 0,
      });
    });

    it('reports how long the page still has restore work queued for', async () => {
      document.body.innerHTML = '<p>Only this paragraph exists so far.</p>';

      await loadContentScript({ highlightsResponse: {} });
      restore([lateGroup('late', 'Late content')]);

      // A retry is queued, so the entry is not missing yet - just not restored
      // yet. The popup waits this out instead of dimming it.
      const pending = send({ action: 'getRestoredGroupIds' });
      expect(pending.groupIds).toEqual([]);
      expect(pending.pendingRestoreMs).toBeGreaterThan(0);

      document.body.innerHTML += '<p>Late content arrives.</p>';
      await jest.advanceTimersByTimeAsync(1500);

      expect(send({ action: 'getRestoredGroupIds' })).toEqual({
        success: true,
        groupIds: ['late'],
        pendingRestoreMs: 0,
      });
    });

    it('keeps reporting pending while the page is still fetching its colors', async () => {
      document.body.innerHTML = '<p>Present content is here.</p>';

      // The timer that leads to the first restore is not even scheduled until
      // this round trip answers, so no elapsed time may make the page look done.
      await loadContentScript({ deferColors: true });
      await jest.advanceTimersByTimeAsync(60000);

      const pending = send({ action: 'getRestoredGroupIds' });
      expect(pending.groupIds).toEqual([]);
      expect(pending.pendingRestoreMs).toBeGreaterThan(0);
    });

    it('keeps reporting pending while the stored highlights are on the way', async () => {
      document.body.innerHTML = '<p>Present content is here.</p>';

      await loadContentScript({ deferHighlights: true });
      await Promise.resolve();
      // The 500ms timer has fired and loadHighlights has asked, but the answer
      // that would run the restore has not come back.
      await jest.advanceTimersByTimeAsync(60000);

      const asked = chrome.runtime.sendMessage.mock.calls
        .some(([message]) => message.action === 'getHighlights');
      expect(asked).toBe(true);

      expect(send({ action: 'getRestoredGroupIds' }).pendingRestoreMs).toBeGreaterThan(0);
    });

    it('stops reporting pending when no restore is coming at all', async () => {
      document.body.innerHTML = '<p>Present content is here.</p>';

      // Colors never arrive, so nothing will call loadHighlights. Reporting this
      // as pending forever would make the popup wait out its whole budget on
      // every page where the background is unreachable.
      await loadContentScript({ failColors: true });
      await Promise.resolve();
      await Promise.resolve();

      expect(send({ action: 'getRestoredGroupIds' }).pendingRestoreMs).toBe(0);
    });

    it('stops reporting pending work once the queued retry has run', async () => {
      document.body.innerHTML = '<p>Only this paragraph exists so far.</p>';

      await loadContentScript({ highlightsResponse: {} });
      restore([lateGroup('late', 'Late content')]);
      await jest.advanceTimersByTimeAsync(1500);

      // The retry ran and found nothing. Now the entry really is missing, and
      // the popup has to mark it rather than keep waiting.
      expect(send({ action: 'getRestoredGroupIds' })).toEqual({
        success: true,
        groupIds: [],
        pendingRestoreMs: 0,
      });
    });

    it('restores a group on request once its text is on the page', async () => {
      document.body.innerHTML = '<p>Only this paragraph exists so far.</p>';

      const group = {
        groupId: 'late',
        color: '#ffff00',
        text: 'Late content',
        selectors: {
          quote: { exact: 'Late content', prefix: '', suffix: '' },
          textPosition: { start: 0, end: 12 },
        },
        spans: [{ text: 'Late content', position: 0 }],
      };

      await loadContentScript({ highlightsResponse: {} });
      restore([group]);
      expect(send({ action: 'getRestoredGroupIds' }).groupIds).toEqual([]);

      document.body.innerHTML += '<p>Late content arrives.</p>';

      expect(send({ action: 'retryRestoreHighlight', groupId: 'late' })).toEqual({
        success: true,
        restored: true,
      });
      expect(highlightedTextFor('late')).toBe('Late content');
    });

    it('reports failure when the text is still not on the page', async () => {
      document.body.innerHTML = '<p>Only this paragraph exists so far.</p>';

      await loadContentScript({ highlightsResponse: {} });
      restore([{
        groupId: 'gone',
        color: '#ffff00',
        text: 'Vanished content',
        selectors: {
          quote: { exact: 'Vanished content', prefix: '', suffix: '' },
          textPosition: { start: 0, end: 16 },
        },
        spans: [{ text: 'Vanished content', position: 0 }],
      }]);

      expect(send({ action: 'retryRestoreHighlight', groupId: 'gone' })).toEqual({
        success: true,
        restored: false,
      });
    });

    it('rejects a group id the page does not know about', async () => {
      document.body.innerHTML = '<p>Present content is here.</p>';

      await loadContentScript({ highlightsResponse: {} });
      restore([makeGroup('ok', 'Present content')]);

      expect(send({ action: 'retryRestoreHighlight', groupId: 'nope' })).toEqual({
        success: false,
        reason: 'unknown-group',
      });
    });
  });

  it('does not wrap a group again when a second pass runs over the same page', async () => {
    document.body.innerHTML = '<p>Present content is here.</p>';

    await loadContentScript({ highlightsResponse: {} });
    restore([makeGroup('ok', 'Present content')]);
    expect(document.querySelectorAll('[data-group-id="ok"]')).toHaveLength(1);

    // Two restores can overlap - the load timer and a navigation pass both in
    // flight, or a queued retry another pass has already satisfied. A group's
    // own highlighted text counts as page text now, so this pass can find it.
    window.applyHighlights();

    expect(document.querySelectorAll('[data-group-id="ok"]')).toHaveLength(1);
    expect(highlightedTextFor('ok')).toBe('Present content');
  });

  it('leaves nothing highlighted when neither the quote nor the legacy spans match', async () => {
    document.body.innerHTML = '<p>Anchor text for selector building.</p>';
    const group = makeGroup('gone', 'Anchor text');

    // The page the highlight was saved on is gone entirely.
    document.body.innerHTML = '<p>Completely different content.</p>';

    await loadContentScript();
    restore([group]);

    expect(document.querySelectorAll('.text-highlighter-extension')).toHaveLength(0);
  });
});
