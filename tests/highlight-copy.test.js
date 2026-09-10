import {
  copyableHighlights,
  formatPageMarkdown,
  formatPagesMarkdown,
  pageTitleForCopy,
} from '../shared/highlight-copy.js';

const PAGE = {
  title: 'An [article]',
  url: 'https://example.com/read(1)',
  highlights: [
    { text: 'second', spans: [{ position: 20 }] },
    { text: '\r\nfirst line\r\n\r\nfirst paragraph two\r\n', spans: [{ position: 10 }] },
    { text: '   ', spans: [{ position: 5 }] },
  ],
};

describe('highlight Markdown formatting', () => {
  it('groups a page under one linked title in document order', () => {
    expect(formatPageMarkdown(PAGE)).toBe(
      '## [An \\[article\\]](https://example.com/read%281%29)\n\n' +
      '> first line\n>\n> first paragraph two\n\n> second',
    );
  });

  it('drops blank records without mutating the input order', () => {
    expect(copyableHighlights(PAGE.highlights).map(group => group.text.trim())).toEqual([
      'first line\r\n\r\nfirst paragraph two',
      'second',
    ]);
    expect(PAGE.highlights[0].text).toBe('second');
  });

  it('separates multiple page sections', () => {
    const output = formatPagesMarkdown([
      { title: 'One', url: 'https://one.example', highlights: [{ text: 'alpha' }] },
      { title: 'Two', url: 'https://two.example', highlights: [{ text: 'beta' }] },
    ]);
    expect(output).toContain('> alpha\n\n---\n\n## [Two]');
    expect(output).toContain('> beta');
  });

  it('keeps Markdown punctuation literal inside a quotation', () => {
    expect(formatPageMarkdown(PAGE, [{ text: '# A *marked* [label] and `code`' }])).toContain(
      '> \\# A \\*marked\\* \\[label\\] and \\`code\\`',
    );
  });

  it('keeps table pipes and tildes literal inside a quotation', () => {
    expect(formatPageMarkdown(PAGE, [{ text: '| Header |\n| --- |\n| ~~value~~ |' }])).toContain(
      '> \\| Header \\|\n> \\| --- \\|\n> \\| \\~\\~value\\~\\~ \\|',
    );
  });

  it('keeps thematic breaks and setext underlines literal inside a quotation', () => {
    expect(formatPageMarkdown(PAGE, [{ text: 'Title\n===\n---' }])).toContain(
      '> Title\n> \\===\n> \\---',
    );
  });

  it('keeps ordered-list markers literal inside a quotation', () => {
    expect(formatPageMarkdown(PAGE, [{ text: '1. first step\n2) second step' }])).toContain(
      '> 1\\. first step\n> 2\\) second step',
    );
  });

  it('keeps inline Markdown punctuation literal inside a link label', () => {
    expect(formatPageMarkdown(
      { title: 'An *important* `note` and ~~old~~ text', url: 'https://example.com/read' },
      [{ text: 'quote' }],
    )).toContain('## [An \\*important\\* \\`note\\` and \\~\\~old\\~\\~ text](https://example.com/read)');
  });

  it('does not create a clickable link for an unsafe legacy URL', () => {
    expect(formatPageMarkdown(
      { title: 'Unsafe', url: 'javascript:alert(1)' },
      [{ text: 'quote' }],
    )).toBe('## Unsafe\n\n> quote');
  });

  it('falls back to the host and path when the saved title is empty', () => {
    expect(pageTitleForCopy({ title: '', url: 'https://example.com/folder/page' }))
      .toBe('example.com/folder/page');
  });
});
