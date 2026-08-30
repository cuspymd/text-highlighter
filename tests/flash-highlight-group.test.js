import { jest } from '@jest/globals';
import { loadContentScripts, resetContentScriptEnvironment } from './helpers/content-script.js';

describe('flashHighlightGroup', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetContentScriptEnvironment();
    loadContentScripts(['common']);
  });

  afterEach(() => {
    jest.useRealTimers();
    resetContentScriptEnvironment();
  });

  function addHighlightSpan(groupId, text) {
    const span = document.createElement('span');
    span.className = 'text-highlighter-extension';
    span.dataset.groupId = groupId;
    span.textContent = text;
    document.body.appendChild(span);
    return span;
  }

  it('flashes every span in the group', () => {
    const first = addHighlightSpan('12345', 'first');
    const second = addHighlightSpan('12345', 'second');

    window.flashHighlightGroup(first);

    expect(first.getAttribute('data-highlighted')).toBe('true');
    expect(second.getAttribute('data-highlighted')).toBe('true');

    jest.advanceTimersByTime(1500);

    expect(first.hasAttribute('data-highlighted')).toBe(false);
    expect(second.hasAttribute('data-highlighted')).toBe(false);
  });

  it('does not throw for group ids containing CSS selector syntax', () => {
    const trickyId = "grp']\\\"x";
    const first = addHighlightSpan(trickyId, 'first');
    const second = addHighlightSpan(trickyId, 'second');

    expect(() => window.flashHighlightGroup(first)).not.toThrow();

    expect(first.getAttribute('data-highlighted')).toBe('true');
    expect(second.getAttribute('data-highlighted')).toBe('true');
  });
});
