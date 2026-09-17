import { jest } from '@jest/globals';
import {
  loadContentScripts,
  respondToBackground,
  respondToStorage,
  resetContentScriptEnvironment,
} from './helpers/content-script.js';

describe('jumpToAdjacentHighlight message handling', () => {
  let page;

  // jsdom lays nothing out, so each span reports the top given in its markup -
  // relative to the viewport, which is where getBoundingClientRect measures.
  function renderSpans(spans) {
    document.body.innerHTML = spans
      .map(([groupId, top]) => `<span class="text-highlighter-extension" data-group-id="${groupId}" data-top="${top}">x</span>`)
      .join('');
    document.querySelectorAll('.text-highlighter-extension').forEach((span) => {
      span.getBoundingClientRect = () => {
        const top = Number(span.dataset.top);
        const size = top < 0 ? 0 : 20;
        return { top, bottom: top + size, width: size, height: size };
      };
    });
  }

  function moveViewportBy(delta) {
    document.querySelectorAll('.text-highlighter-extension').forEach((span) => {
      span.dataset.top = String(Number(span.dataset.top) - delta);
    });
  }

  const jump = direction => page.sendToContentScript({ action: 'jumpToAdjacentHighlight', direction });

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetContentScriptEnvironment();

    respondToBackground(message => {
      if (message.action === 'getColors') return { colors: [] };
      if (message.action === 'getHighlights') return { highlights: [] };
      return { success: true };
    });
    respondToStorage({ minimapVisible: true });

    page = loadContentScripts(['content']);
    await jest.advanceTimersByTimeAsync(500);
  });

  afterEach(() => {
    jest.useRealTimers();
    resetContentScriptEnvironment();
  });

  it('answers with no-highlights on a page without any', async () => {
    document.body.innerHTML = '<p>plain</p>';

    expect(await jump('next')).toEqual({ success: false, reason: 'no-highlights' });
    expect(window.scrollToHighlightElement).not.toHaveBeenCalled();
  });

  it('scrolls to and flashes the first span of the next group', async () => {
    renderSpans([['a', 200], ['a', 220], ['b', 400]]);
    const [firstOfA] = document.querySelectorAll('[data-group-id="a"]');

    expect(await jump('next')).toEqual({ success: true, groupId: 'a' });
    expect(window.scrollToHighlightElement).toHaveBeenCalledWith(firstOfA);
    expect(window.flashHighlightGroup).toHaveBeenCalledWith(firstOfA);
  });

  it('moves on from the last jump rather than landing on it again', async () => {
    renderSpans([['a', 200], ['b', 400], ['c', 600]]);

    expect((await jump('next')).groupId).toBe('a');
    expect((await jump('next')).groupId).toBe('b');
    expect((await jump('previous')).groupId).toBe('a');
  });

  it('keeps following the last jump after the scroll settles while it stays in view', async () => {
    renderSpans([['a', 200], ['b', 400]]);

    await jump('next');
    await jest.advanceTimersByTimeAsync(5000);

    expect((await jump('next')).groupId).toBe('b');
  });

  it('starts from the viewport again once the reader has scrolled away', async () => {
    renderSpans([['a', 200], ['b', 1400], ['c', 2600]]);

    await jump('next');
    await jest.advanceTimersByTimeAsync(5000);
    moveViewportBy(2000);

    // 'a' is out of view, so the next group is the first one below the viewport.
    expect((await jump('next')).groupId).toBe('c');
  });

  it('skips groups that render no box', async () => {
    renderSpans([['hidden', -1], ['shown', 300]]);

    expect((await jump('next')).groupId).toBe('shown');
    expect((await jump('next')).groupId).toBe('shown');
  });
});
