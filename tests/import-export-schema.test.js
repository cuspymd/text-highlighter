import { validateImportPayload } from '../shared/import-export-schema.js';

describe('import-export schema validation', () => {
  it('should reject payloads without pages array', () => {
    const result = validateImportPayload({});
    expect(result.valid).toBe(false);
    expect(result.pages).toEqual([]);
  });

  it('should accept a valid payload', () => {
    const result = validateImportPayload({
      pages: [
        {
          url: 'https://example.com',
          title: 'Example',
          lastUpdated: '2026-02-01T00:00:00.000Z',
          highlights: [
            {
              groupId: 'g1',
              color: 'yellow',
              text: 'hello',
              spans: [{ spanId: 's1', text: 'hello', position: 10 }],
            },
          ],
        },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].highlights).toHaveLength(1);
    expect(result.stats.acceptedPages).toBe(1);
    expect(result.stats.rejectedPages).toBe(0);
  });

  it('should reject pages missing url or highlights', () => {
    const result = validateImportPayload({
      pages: [
        { title: 'No URL', highlights: [] },
        { url: 'https://example.com' },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.pages).toHaveLength(0);
    expect(result.stats.rejectedPages).toBe(2);
  });

  it('should drop invalid groups and spans but keep valid data', () => {
    const result = validateImportPayload({
      pages: [
        {
          url: 'https://example.com',
          highlights: [
            {
              groupId: 'valid-group',
              color: '#ffff00',
              text: '',
              spans: [
                { text: 'valid span', position: 0 },
                { text: '', position: 1 },
              ],
            },
            {
              groupId: 'invalid-group',
              color: '',
              spans: [{ text: 'no color' }],
            },
          ],
        },
      ],
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].highlights).toHaveLength(1);
    expect(result.pages[0].highlights[0].spans).toHaveLength(1);
    expect(result.stats.rejectedHighlights).toBe(1);
    expect(result.stats.rejectedSpans).toBe(1);
  });

  it('should fallback invalid date and missing groupId', () => {
    const result = validateImportPayload({
      pages: [
        {
          url: 'https://example.com',
          title: 'Example',
          lastUpdated: 'not-a-date',
          highlights: [
            {
              color: 'green',
              spans: [{ text: 'abc' }],
            },
          ],
        },
      ],
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.pages[0].highlights[0].groupId).toBe('import-0-0');
    expect(result.pages[0].highlights[0].text).toBe('abc');
  });
});
