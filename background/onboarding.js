import { browserAPI } from '../shared/browser-api.js';
import { debugLog } from '../shared/logger.js';

export const ONBOARDING_PAGE = 'onboarding.html';

/**
 * Open the usage guide, but only on a fresh install.
 *
 * `onInstalled` also fires on every extension update and on a browser update.
 * Reacting to those would drop a guide tab in front of people who already know
 * the extension, once per auto-update - the opposite of what onboarding is for.
 * The reason check is the whole point of this module.
 *
 * Returns whether a tab was opened, which is what the tests assert on.
 */
export async function openGuideOnInstall(details) {
  if (!details || details.reason !== 'install') {
    debugLog('Not a fresh install, leaving the guide closed:', details && details.reason);
    return false;
  }

  try {
    await browserAPI.tabs.create({ url: browserAPI.runtime.getURL(ONBOARDING_PAGE) });
    return true;
  } catch (error) {
    // A guide that will not open is not worth failing an install over.
    debugLog('Failed to open the onboarding guide:', error);
    return false;
  }
}
