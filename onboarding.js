import { browserAPI } from './shared/browser-api.js';

// The guide is static markup, so localization is all this page does. Same shape
// as the other pages' initializeI18n, minus the input branches the guide has no
// use for.
function initializeI18n() {
  const elements = document.querySelectorAll('[data-i18n]');

  elements.forEach(element => {
    const key = element.getAttribute('data-i18n');
    const message = browserAPI.i18n.getMessage(key);
    if (message) {
      element.textContent = message;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initializeI18n();
});
