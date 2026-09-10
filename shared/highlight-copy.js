function normalizeText(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && !lines[0].trim()) lines.shift();
  while (lines.length > 0 && !lines.at(-1).trim()) lines.pop();
  return lines.join('\n');
}

function escapeLinkLabel(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/([\[\]])/g, '\\$1').replace(/\s+/g, ' ').trim();
}

function safeLinkUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) return '';
    return parsed.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
  } catch (error) {
    return '';
  }
}

export function pageTitleForCopy(page, fallback = '(No title)') {
  const title = String(page?.title ?? '').trim();
  if (title && title !== fallback) return title;
  try {
    const url = new URL(page?.url ?? '');
    return `${url.hostname}${url.pathname}` || page.url || fallback;
  } catch (error) {
    return page?.url || fallback;
  }
}

export function sortHighlightsByPosition(highlights) {
  return [...(highlights || [])].sort((a, b) => {
    const positionA = a.spans?.[0]?.position ?? 0;
    const positionB = b.spans?.[0]?.position ?? 0;
    return positionA - positionB;
  });
}

export function copyableHighlights(highlights) {
  return sortHighlightsByPosition(highlights).filter(group => normalizeText(group?.text));
}

function pageLink(page, fallbackTitle) {
  const title = escapeLinkLabel(pageTitleForCopy(page, fallbackTitle));
  const url = safeLinkUrl(page?.url);
  return url ? `[${title}](${url})` : title;
}

function quoteMarkdown(text) {
  return normalizeText(text).split('\n').map(line => {
    if (!line) return '>';
    const escaped = line
      .replace(/\\/g, '\\\\')
      .replace(/([`*_[\]<>])/g, '\\$1')
      .replace(/^(\s*)(#{1,6}|>|[-+])(?=\s)/, '$1\\$2')
      .replace(/^(\s*\d+)\.(?=\s)/, '$1\\.');
    return `> ${escaped}`;
  }).join('\n');
}

export function formatPageMarkdown(page, highlights = page?.highlights, options = {}) {
  const groups = copyableHighlights(highlights);
  if (groups.length === 0) return '';
  const quotes = groups.map(group => quoteMarkdown(group.text)).join('\n\n');
  return `## ${pageLink(page, options.fallbackTitle)}\n\n${quotes}`;
}

export function formatPagesMarkdown(pages, options = {}) {
  return (pages || [])
    .map(page => formatPageMarkdown(page, page.highlights, options))
    .filter(Boolean)
    .join('\n\n---\n\n');
}
