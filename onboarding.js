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

  // The online guide is a different page per language, so the link target is
  // localized alongside its label. A locale with no message here keeps the
  // English URL already in the markup.
  const elementsWithHref = document.querySelectorAll('[data-i18n-href]');

  elementsWithHref.forEach(element => {
    const key = element.getAttribute('data-i18n-href');
    const message = browserAPI.i18n.getMessage(key);
    if (message) {
      element.href = message;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initializeI18n();
});
