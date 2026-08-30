import { jest } from '@jest/globals';
import chrome from '../mocks/chrome.js';
import { sendToBackground } from '../shared/runtime-message.js';

describe('sendToBackground', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends the message in the promise form and returns the answer', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, pages: [] });

    const response = await sendToBackground({ action: 'getAllHighlightedPages' });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'getAllHighlightedPages' });
    expect(response).toEqual({ success: true, pages: [] });
  });

  // A sleeping or restarting service worker rejects. The callback form used to
  // deliver that as an undefined response, which every caller's
  // `if (!response || !response.success)` already handled - so the rejection has
  // to arrive the same way, or those branches stop running.
  it('returns null when the background does not answer', async () => {
    chrome.runtime.sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));

    await expect(sendToBackground({ action: 'getAllHighlightedPages' })).resolves.toBeNull();
  });

  it('passes an unsuccessful answer through untouched', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: false, error: 'storage is gone' });

    const response = await sendToBackground({ action: 'deleteAllHighlightedPages' });

    expect(response).toEqual({ success: false, error: 'storage is gone' });
  });

  it('sends exactly one argument, leaving no callback slot to get wrong', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: true });

    await sendToBackground({ action: 'getColors' });

    expect(chrome.runtime.sendMessage.mock.calls[0]).toHaveLength(1);
  });
});
