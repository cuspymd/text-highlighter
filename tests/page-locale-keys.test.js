import { jest } from '@jest/globals';
import fs from 'fs';
import chrome from '../mocks/chrome.js';
import { setDocumentLanguage } from '../shared/document-language.js';

// Every message an extension page asks for must exist in every locale. A
// missing key does not fail anywhere: getMessage returns '' and the page shows
// its English fallback, in every language, which is how importError,
// exportError and noHighlightsToExport went unnoticed.
const root = new URL('../', import.meta.url);
const PAGES = ['popup', 'settings', 'pages-list', 'onboarding'];

function read(path) {
  return fs.readFileSync(new URL(path, root), 'utf8');
}

function keysUsedBy(page) {
  const keys = new Set();
  const script = read(`${page}.js`);
  for (const match of script.matchAll(/getMessage\(\s*'([A-Za-z0-9_]+)'/g)) {
    keys.add(match[1]);
  }
  const html = read(`${page}.html`);
  for (const match of html.matchAll(/data-i18n(?:-[a-z]+)?="([A-Za-z0-9_]+)"/g)) {
    keys.add(match[1]);
  }
  return [...keys];
}

const locales = fs.readdirSync(new URL('_locales/', root));
const messagesByLocale = Object.fromEntries(
  locales.map(locale => [locale, JSON.parse(read(`_locales/${locale}/messages.json`))]),
);

describe.each(PAGES)('%s', page => {
  const keys = keysUsedBy(page);

  it('asks for at least one message (the scan is finding them)', () => {
    expect(keys.length).toBeGreaterThan(0);
  });

  it.each(locales)('has every message it uses in %s', locale => {
    const missing = keys.filter(key => !messagesByLocale[locale][key]?.message);
    expect(missing).toEqual([]);
  });
});

describe('setDocumentLanguage', () => {
  afterEach(() => {
    delete chrome.i18n.getUILanguage;
    document.documentElement.removeAttribute('lang');
  });

  it('marks the page with the UI language', () => {
    chrome.i18n.getUILanguage = jest.fn(() => 'ko');
    setDocumentLanguage();
    expect(document.documentElement.lang).toBe('ko');
  });

  it('leaves lang alone when the browser does not say', () => {
    setDocumentLanguage();
    expect(document.documentElement.hasAttribute('lang')).toBe(false);
  });
});

describe.each(PAGES)('%s.js', page => {
  it('sets the document language', () => {
    expect(read(`${page}.js`)).toMatch(/setDocumentLanguage\(\)/);
  });
});
