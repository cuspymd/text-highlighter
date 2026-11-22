import fs from 'fs';
import chrome, { assertNoRuntimeMessageCallback } from '../mocks/chrome.js';

/**
 * The guard that keeps background messages in the promise form.
 *
 * `tabs.sendMessage` has the same rule, tested alongside the helper that owns it
 * in tab-broadcast.test.js. There is no equivalent helper for background
 * messages - callers await `runtime.sendMessage` directly - so the guard is
 * tested here, on its own.
 */
describe('the runtime.sendMessage promise-form guard', () => {
  it('rejects a callback in the second argument', () => {
    expect(() => assertNoRuntimeMessageCallback([() => {}])).toThrow(/Use the promise form/);
  });

  it("rejects a callback after Chrome's options argument", () => {
    expect(() => assertNoRuntimeMessageCallback([{ includeTlsChannelId: false }, () => {}]))
      .toThrow(/Use the promise form/);
  });

  it('allows options on their own', () => {
    expect(() => assertNoRuntimeMessageCallback([{ includeTlsChannelId: false }])).not.toThrow();
  });

  it('allows a message on its own', () => {
    expect(() => assertNoRuntimeMessageCallback([])).not.toThrow();
  });

  // The guard is only worth having if the mock actually applies it, rather than
  // taking the callback and answering it the way Chrome would.
  it('is wired into the mock, so a callback fails the suite by name', () => {
    expect(() => chrome.runtime.sendMessage({ action: 'getColors' }, () => {}))
      .toThrow(/Use the promise form/);
  });

  it('answers the promise form', async () => {
    await expect(chrome.runtime.sendMessage({ action: 'getColors' })).resolves.toEqual({ success: true });
  });
});

// Extension pages reach the background through sendToBackground, which turns a
// background that is not listening into null. A bare runtime.sendMessage rejects
// there instead, and the click or the page setup that awaited it stops silently.
// Content scripts are not modules and cannot import it, so they are not listed.
describe('extension pages', () => {
  const PAGE_SCRIPTS = ['popup.js', 'settings.js', 'pages-list.js', 'onboarding.js'];

  it.each(PAGE_SCRIPTS)('%s sends to the background through sendToBackground only', file => {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    expect(source).not.toMatch(/runtime\.sendMessage\s*\(/);
  });
});
