const DEBUG_MODE = false;

var debugLog = DEBUG_MODE ? console.log.bind(console) : () => {};

// Cross-browser compatibility: use browser API in Firefox, chrome API in Chromium.
var browserAPI = window.browserAPI || (() => {
  if (typeof browser !== 'undefined') {
    return browser;
  }
  if (typeof chrome !== 'undefined') {
    return chrome;
  }
  throw new Error('Neither browser nor chrome API is available');
})();
window.browserAPI = browserAPI;

// i18n helper shared by content scripts.
function getMessage(key, substitutions = null) {
  return browserAPI.i18n.getMessage(key, substitutions);
}
