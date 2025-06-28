export const COLORS = [
  { id: 'yellow', nameKey: 'yellowColor', color: '#FFFF00' },
  { id: 'green', nameKey: 'greenColor', color: '#AAFFAA' },
  { id: 'blue', nameKey: 'blueColor', color: '#AAAAFF' },
  { id: 'pink', nameKey: 'pinkColor', color: '#FFAAFF' },
  { id: 'orange', nameKey: 'orangeColor', color: '#FFAA55' }
];

// Cross-browser compatibility - use chrome API in Chrome, browser API in Firefox
const browserAPI = (() => {
  if (typeof browser !== 'undefined') {
    return browser;
  }
  if (typeof chrome !== 'undefined') {
    return chrome;
  }
  throw new Error('Neither browser nor chrome API is available');
})();

export function getMessage(key, substitutions = null) {
  return browserAPI.i18n.getMessage(key, substitutions);
}
