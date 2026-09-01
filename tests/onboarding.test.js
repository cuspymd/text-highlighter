import chrome from '../mocks/chrome.js';
import { ONBOARDING_PAGE, openGuideOnInstall } from '../background/onboarding.js';

const GUIDE_URL = `chrome-extension://test/${ONBOARDING_PAGE}`;

describe('background/onboarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens the guide on a fresh install', async () => {
    const opened = await openGuideOnInstall({ reason: 'install' });

    expect(opened).toBe(true);
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: GUIDE_URL });
  });

  // onInstalled fires on every extension and browser update too. Opening a tab
  // there would put the guide in front of people who already use the extension,
  // once per auto-update - the case this whole module exists to rule out.
  it.each(['update', 'chrome_update', 'shared_module_update'])(
    'leaves the guide closed when the reason is %s',
    async reason => {
      const opened = await openGuideOnInstall({ reason });

      expect(opened).toBe(false);
      expect(chrome.tabs.create).not.toHaveBeenCalled();
    }
  );

  it('leaves the guide closed when there is no reason to read', async () => {
    expect(await openGuideOnInstall(undefined)).toBe(false);
    expect(await openGuideOnInstall({})).toBe(false);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('swallows a tab that will not open rather than failing the install', async () => {
    chrome.tabs.create.mockRejectedValueOnce(new Error('no window to open into'));

    await expect(openGuideOnInstall({ reason: 'install' })).resolves.toBe(false);
  });
});
