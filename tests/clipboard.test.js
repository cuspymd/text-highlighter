import { jest } from '@jest/globals';
import { copyTextToClipboard } from '../shared/clipboard.js';

describe('copyTextToClipboard', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = jest.fn();
  });

  it('uses the async clipboard API when available', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    await expect(copyTextToClipboard('quoted text')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('quoted text');
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('falls back to a selected textarea and removes it afterwards', async () => {
    document.execCommand.mockReturnValue(true);

    await expect(copyTextToClipboard('fallback text')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports failure when neither path can copy', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    document.execCommand.mockReturnValue(false);

    await expect(copyTextToClipboard('blocked')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
