import { STORAGE_KEYS, CLOUD_SYNC_KEYS, isPageKey } from '../constants/storage-keys.js';

describe('isPageKey', () => {
  it('accepts a url holding a highlight list, empty or not', () => {
    expect(isPageKey('https://example.com/a', [{ groupId: 'g1' }])).toBe(true);
    expect(isPageKey('https://example.com/a', [])).toBe(true);
  });

  it("rejects a page's _meta companion", () => {
    expect(isPageKey(`https://example.com/a${STORAGE_KEYS.META_SUFFIX}`, [])).toBe(false);
  });

  it('rejects a non-array value', () => {
    expect(isPageKey('https://example.com/a', { title: 'x' })).toBe(false);
    expect(isPageKey('https://example.com/a', undefined)).toBe(false);
  });

  // customColors is an array, so these have to be ruled out by name.
  it.each([
    ...Object.values(STORAGE_KEYS).filter(key => key !== STORAGE_KEYS.META_SUFFIX),
    ...Object.values(CLOUD_SYNC_KEYS),
    'settings',
  ])('rejects the setting %s even when it holds an array', key => {
    expect(isPageKey(key, [])).toBe(false);
  });
});
