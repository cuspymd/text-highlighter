import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import {
  loadContentScripts,
  respondToBackground,
  respondToStorage,
  resetContentScriptEnvironment,
} from './helpers/content-script.js';

describe('scrollToHighlight message handling', () => {
  let page;

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
    chrome.runtime.sendMessage.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetContentScriptEnvironment();
  });

  it('scrolls to and flashes the highlight when the group exists in the DOM', async () => {
    document.body.innerHTML =
      "<p><span class='text-highlighter-extension' data-group-id='12345'>hello</span></p>";
    const target = document.querySelector('.text-highlighter-extension');

    const response = await page.sendToContentScript({ action: 'scrollToHighlight', groupId: '12345' });

    expect(window.scrollToHighlightElement).toHaveBeenCalledWith(target);
    expect(window.flashHighlightGroup).toHaveBeenCalledWith(target);
    expect(response).toEqual({ success: true });
  });

  it('responds with success: false when no element matches the group', async () => {
    const response = await page.sendToContentScript({ action: 'scrollToHighlight', groupId: 'missing' });

    expect(window.scrollToHighlightElement).not.toHaveBeenCalled();
    expect(window.flashHighlightGroup).not.toHaveBeenCalled();
    expect(response).toEqual({ success: false, reason: 'not-found' });
  });

  it('responds with success: false when groupId is missing', async () => {
    const response = await page.sendToContentScript({ action: 'scrollToHighlight' });

    expect(response).toEqual({ success: false, reason: 'not-found' });
  });
});
