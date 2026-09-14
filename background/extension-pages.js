import { browserAPI } from '../shared/browser-api.js';
import { sendMessageToTab } from '../shared/tab-broadcast.js';

// The extension pages the in-page controls can open. Firefox for Android has no
// toolbar button to pin, so the pages behind the popup take four taps or more
// there; the mobile highlight bar's more menu reaches them in two.
//
// The popup itself is not among them: action.openPopup() did not open anything
// on Firefox for Android when called for a press in the page.
const PAGE_PATHS = {
  pagesList: 'pages-list.html',
  settings: 'settings.html',
};

/**
 * Open `page` in a tab. A tab that already shows it is focused instead, the way
 * the popup's own buttons do on mobile, so repeated presses do not pile up tabs.
 */
export async function openExtensionPage(page) {
  if (!Object.prototype.hasOwnProperty.call(PAGE_PATHS, page)) {
    return { success: false, error: `Unknown page: ${page}` };
  }

  const url = browserAPI.runtime.getURL(PAGE_PATHS[page]);
  const tabs = await browserAPI.tabs.query({});
  const existingTab = tabs.find(tab => tab.url && tab.url.startsWith(url));
  if (existingTab) {
    await browserAPI.tabs.update(existingTab.id, { active: true });
    if (page === 'pagesList') {
      await sendMessageToTab(existingTab.id, { action: 'refreshPagesList' });
    }
    return { success: true, opened: 'existing-tab' };
  }

  await browserAPI.tabs.create({ url });
  return { success: true, opened: 'tab' };
}
