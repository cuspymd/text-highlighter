function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function toIsoStringOrNow(value) {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return value;
  }
  return new Date().toISOString();
}

function normalizeSpan(span) {
  if (!isPlainObject(span)) {
    return { ok: false, reason: 'span must be an object' };
  }

  if (!isNonEmptyString(span.text)) {
    return { ok: false, reason: 'span.text must be a non-empty string' };
  }

  return {
    ok: true,
    value: {
      text: span.text,
      position: Number.isFinite(span.position) ? span.position : 0,
      spanId: isNonEmptyString(span.spanId) ? span.spanId : undefined,
    },
  };
}

function normalizeHighlightGroup(group, groupIdFallback) {
  if (!isPlainObject(group)) {
    return { ok: false, reason: 'highlight group must be an object' };
  }

  if (!isNonEmptyString(group.color)) {
    return { ok: false, reason: 'group.color must be a non-empty string' };
  }

  if (!Array.isArray(group.spans)) {
    return { ok: false, reason: 'group.spans must be an array' };
  }

  const spans = [];
  let rejectedSpans = 0;

  for (const rawSpan of group.spans) {
    const normalized = normalizeSpan(rawSpan);
    if (!normalized.ok) {
      rejectedSpans += 1;
      continue;
    }
    spans.push(normalized.value);
  }

  if (spans.length === 0) {
    return { ok: false, reason: 'group contains no valid spans', rejectedSpans };
  }

  return {
    ok: true,
    value: {
      groupId: isNonEmptyString(group.groupId) ? group.groupId : groupIdFallback,
      color: group.color,
      text: isNonEmptyString(group.text) ? group.text : spans.map(span => span.text).join(''),
      spans,
    },
    rejectedSpans,
  };
}

function normalizePage(page, pageIndex) {
  if (!isPlainObject(page)) {
    return { ok: false, reason: 'page must be an object' };
  }

  if (!isNonEmptyString(page.url)) {
    return { ok: false, reason: 'page.url must be a non-empty string' };
  }

  if (!Array.isArray(page.highlights)) {
    return { ok: false, reason: 'page.highlights must be an array' };
  }

  const highlights = [];
  let rejectedHighlights = 0;
  let rejectedSpans = 0;

  for (let i = 0; i < page.highlights.length; i += 1) {
    const rawGroup = page.highlights[i];
    const normalized = normalizeHighlightGroup(rawGroup, `import-${pageIndex}-${i}`);
    if (!normalized.ok) {
      rejectedHighlights += 1;
      rejectedSpans += normalized.rejectedSpans || 0;
      continue;
    }
    rejectedSpans += normalized.rejectedSpans || 0;
    highlights.push(normalized.value);
  }

  if (highlights.length === 0) {
    return {
      ok: false,
      reason: 'page contains no valid highlights',
      rejectedHighlights,
      rejectedSpans,
    };
  }

  return {
    ok: true,
    value: {
      url: page.url,
      title: typeof page.title === 'string' ? page.title : '',
      lastUpdated: toIsoStringOrNow(page.lastUpdated),
      highlights,
    },
    rejectedHighlights,
    rejectedSpans,
  };
}

export function validateImportPayload(payload) {
  if (!isPlainObject(payload) || !Array.isArray(payload.pages)) {
    return {
      valid: false,
      reason: 'payload.pages must be an array',
      pages: [],
      rejectedPages: [],
      stats: null,
    };
  }

  const pages = [];
  const rejectedPages = [];

  const stats = {
    inputPages: payload.pages.length,
    acceptedPages: 0,
    rejectedPages: 0,
    inputHighlights: 0,
    acceptedHighlights: 0,
    rejectedHighlights: 0,
    inputSpans: 0,
    acceptedSpans: 0,
    rejectedSpans: 0,
  };

  for (let i = 0; i < payload.pages.length; i += 1) {
    const rawPage = payload.pages[i];

    if (isPlainObject(rawPage) && Array.isArray(rawPage.highlights)) {
      stats.inputHighlights += rawPage.highlights.length;
      for (const group of rawPage.highlights) {
        if (isPlainObject(group) && Array.isArray(group.spans)) {
          stats.inputSpans += group.spans.length;
        }
      }
    }

    const normalized = normalizePage(rawPage, i);
    if (!normalized.ok) {
      stats.rejectedPages += 1;
      stats.rejectedHighlights += normalized.rejectedHighlights || 0;
      stats.rejectedSpans += normalized.rejectedSpans || 0;
      rejectedPages.push({
        index: i,
        url: isPlainObject(rawPage) ? rawPage.url : undefined,
        reason: normalized.reason,
      });
      continue;
    }

    pages.push(normalized.value);
    stats.acceptedPages += 1;
    stats.acceptedHighlights += normalized.value.highlights.length;
    stats.rejectedHighlights += normalized.rejectedHighlights || 0;

    for (const group of normalized.value.highlights) {
      stats.acceptedSpans += group.spans.length;
    }
    stats.rejectedSpans += normalized.rejectedSpans || 0;
  }

  return {
    valid: true,
    reason: null,
    pages,
    rejectedPages,
    stats,
  };
}
