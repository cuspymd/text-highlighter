import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import {
  loadContentScripts,
  respondToBackground,
  respondToStorage,
  resetContentScriptEnvironment,
} from './helpers/content-script.js';

// Clicking a highlight is the only way to reach its controls. A highlight inside
// a link followed the link on that same click, so it could not be removed
// without leaving the page. The first click now only opens the controls; a
// second one, with them up, follows the link.
describe('clicking a highlight inside a link', () => {
  const palette = [{ id: 'yellow', nameKey: 'yellowColor', color: '#FFFF00' }];

  beforeAll(async () => {
    jest.useFakeTimers();
    resetContentScriptEnvironment();

    respondToBackground(message => {
      if (message.action === 'getPlatformInfo') return { isMobile: false };
      if (message.action === 'getColors') return { colors: palette };
      if (message.action === 'getHighlights') return { highlights: [] };
      return { success: true };
    });
    respondToStorage({ minimapVisible: false, selectionControlsVisible: false });
    chrome.i18n.getMessage.mockImplementation(key => key);

    // Each evaluated script has its own scope in the harness; in the extension
    // these are one global that content.js and controls.js share.
    window.currentColors = palette.slice();
    window.activeHighlightElement = null;
    window.highlightControlsContainer = null;

    loadContentScripts(['common', 'controls', 'content']);
    await jest.advanceTimersByTimeAsync(600);
  });

  afterAll(() => {
    jest.useRealTimers();
    resetContentScriptEnvironment();
  });

  function highlightIn(html, id) {
    // Dismiss whatever bar an earlier test left up, the way a page click does.
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    window.activeHighlightElement = null;
    document.body.innerHTML = html;

    const range = document.createRange();
    range.selectNodeContents(document.getElementById(id));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    window.highlightSelectedText('#FFFF00');

    const span = document.querySelector('.text-highlighter-extension');
    expect(span).not.toBeNull();
    return span;
  }

  function click(target, init = {}) {
    const event = new MouseEvent('click', {
      bubbles: true, cancelable: true, clientX: 20, clientY: 20, ...init,
    });
    target.dispatchEvent(event);
    return event;
  }

  function controlsVisible() {
    const bar = document.querySelector('.text-highlighter-controls');
    return Boolean(bar && bar.classList.contains('visible'));
  }

  it('opens the controls without following the link on the first click', async () => {
    const span = highlightIn('<p><a id="link" href="https://example.com/">linked text</a></p>', 'link');

    const first = click(span);
    await jest.advanceTimersByTimeAsync(20);

    expect(first.defaultPrevented).toBe(true);
    expect(controlsVisible()).toBe(true);
  });

  it('follows the link on a second click while the controls are up', () => {
    const span = highlightIn('<p><a id="link" href="https://example.com/">linked text</a></p>', 'link');
    click(span);
    // content.js reads the container off the shared global.
    window.highlightControlsContainer = document.querySelector('.text-highlighter-controls');

    const second = click(span);

    expect(second.defaultPrevented).toBe(false);
    window.highlightControlsContainer = null;
  });

  it('lets a modified click open the link in a new tab', () => {
    const span = highlightIn('<p><a id="link" href="https://example.com/">linked text</a></p>', 'link');

    expect(click(span, { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('leaves clicks on highlights outside links alone', async () => {
    const span = highlightIn('<p id="para">plain text</p>', 'para');

    const event = click(span);
    await jest.advanceTimersByTimeAsync(20);

    expect(event.defaultPrevented).toBe(false);
    expect(controlsVisible()).toBe(true);
  });

  it('treats an anchor without href as plain text', () => {
    const span = highlightIn('<p><a id="anchor" name="section">anchor text</a></p>', 'anchor');

    expect(click(span).defaultPrevented).toBe(false);
  });
});
