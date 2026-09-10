import fs from 'fs';

const localesRoot = new URL('../_locales/', import.meta.url);
const copyKeys = [
  'copyPageHighlightsLabel',
  'copyPageHighlightsSuccess',
  'copySearchResultsLabel',
  'copySearchResultsSuccess',
  'copyHighlightsFailed',
];

describe('copy feature translations', () => {
  for (const locale of fs.readdirSync(localesRoot)) {
    it(`has every copy message in ${locale}`, () => {
      const messages = JSON.parse(fs.readFileSync(new URL(`${locale}/messages.json`, localesRoot), 'utf8'));
      for (const key of copyKeys) {
        expect(messages[key]?.message).toEqual(expect.any(String));
        expect(messages[key].message).not.toBe('');
      }
    });
  }
});
