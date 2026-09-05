import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import {
  loadContentScripts,
  respondToBackground,
  respondToStorage,
  resetContentScriptEnvironment,
} from './helpers/content-script.js';

// The palette arrives over a message round trip, and a cold service worker can
// make that round trip long. Everything the palette feeds has to be told when
// it lands, not only when it changes afterwards - the selection icon in
// one-click mode reads it to decide which colour it offers, and an icon raised
// during the round trip was drawn before there was one.
describe('the initial palette load', () => {
  const palette = [{ id: 'yellow', nameKey: 'yellowColor', color: '#FFFF00' }];

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetContentScriptEnvironment();
    respondToStorage({ minimapVisible: false });
  });

  afterEach(() => {
    jest.useRealTimers();
    resetContentScriptEnvironment();
  });

  it('refreshes the colour-driven UI once the palette answers', async () => {
    let answerColors = null;
    respondToBackground(message => {
      if (message.action === 'getColors') {
        return new Promise(resolve => { answerColors = resolve; });
      }
      if (message.action === 'getHighlights') return { highlights: [] };
      return { success: true };
    });

    loadContentScripts(['common', 'content']);
    await jest.advanceTimersByTimeAsync(0);

    // Still waiting on the palette: nothing that reads it has been told
    // anything yet.
    expect(window.refreshHighlightControlsColors).not.toHaveBeenCalled();

    answerColors({ colors: palette });
    await jest.advanceTimersByTimeAsync(0);

    expect(window.refreshHighlightControlsColors).toHaveBeenCalled();
  });
});
