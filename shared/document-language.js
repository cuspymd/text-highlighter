import { browserAPI } from './browser-api.js';

/**
 * Mark the page with the language its text is shown in.
 *
 * The pages are localized at runtime from _locales, so the HTML cannot carry a
 * fixed `lang`. Without one, screen readers pick a voice from their own default
 * and the browser hyphenates and picks CJK glyphs as if the page were English.
 */
export function setDocumentLanguage() {
  const language = browserAPI.i18n.getUILanguage?.();
  if (language) {
    document.documentElement.lang = language;
  }
}
