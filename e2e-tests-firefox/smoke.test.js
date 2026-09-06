/**
 * Three checks, and only three: does the Firefox build come up, does a
 * highlight survive a reload, and do the extension's own pages open. Anything
 * that is the same code on both browsers - anchoring, selection maths, colour
 * handling - is covered by `tests/` and `e2e-tests/`; running it again here
 * would cost a Firefox launch and tell us nothing new.
 *
 * Run before a Firefox release: `npm run test:e2e:firefox` (HEADFUL=1 to watch).
 */
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { By } from 'selenium-webdriver';
import { startHarness } from './harness.js';

describe('Firefox smoke', { concurrency: 1, timeout: 120_000 }, () => {
  let harness;

  before(async () => { harness = await startHarness(); });
  after(async () => { if (harness) await harness.stop(); });
  afterEach(async () => { if (harness) await harness.closeExtraTabs(); });

  it('installs, opens its guide, and answers privileged calls', async () => {
    const url = await harness.urlOf(harness.extensionTab);
    assert.match(url, /^moz-extension:\/\/.+\/onboarding\.html$/);

    // The guide tab stands in for the background here, so a driver that cannot
    // reach the extension APIs from it makes the rest of the suite meaningless.
    const reach = await harness.inExtension(function (done) {
      done({
        id: browser.runtime.id,
        tabs: !!browser.tabs,
        storage: !!browser.storage,
      });
    });
    assert.equal(reach.id, 'text-highlighter@marks.extension');
    assert.ok(reach.tabs && reach.storage, 'extension APIs are not reachable from the guide tab');
  });

  it('highlights a selection and restores it after a reload', async () => {
    await harness.openPage('test-page.html');
    assert.ok(await harness.waitForContentScript(), 'the content script never came up in the page');

    const expected = 'This is a sample paragraph with some text that can be highlighted.';

    await harness.inPage(function () {
      const paragraph = [...document.querySelectorAll('p')]
        .find(el => el.textContent.includes('This is a sample paragraph'));
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });

    // The promise form of tabs.sendMessage is the call that goes silently dead
    // on Firefox when someone reaches for a callback, so drive the highlight
    // through it rather than through the selection controls.
    const sent = await harness.sendToPage({ action: 'highlight', color: 'yellow' });
    assert.ok(sent.ok, `the highlight message never reached the content script: ${sent.error}`);

    const readHighlights = function () {
      const spans = [...document.querySelectorAll('span.text-highlighter-extension')];
      if (!spans.length) return null;
      return spans.map(span => ({
        text: span.textContent,
        background: getComputedStyle(span).backgroundColor,
      }));
    };

    const drawn = await harness.waitInPage(readHighlights);
    assert.deepEqual(drawn, [{ text: expected, background: 'rgb(255, 255, 0)' }]);

    // The content script answers the message as soon as the span is drawn and
    // fires the save without awaiting it, so a reload timed off the DOM alone
    // can outrun storage and blame the restore for a save that never landed.
    const saved = await harness.waitInExtension(function (done) {
      browser.storage.local.get(null).then(stored => {
        const key = Object.keys(stored)
          .find(name => name.includes('/test-page.html') && !name.endsWith('_meta'));
        const groups = key ? stored[key] : null;
        done(groups && groups.length ? groups.length : null);
      }, () => done(null));
    });
    assert.equal(saved, 1, 'the highlight never reached storage, so a reload would prove nothing');

    await harness.reloadPage();
    const restored = await harness.waitInPage(readHighlights);
    assert.deepEqual(restored, [{ text: expected, background: 'rgb(255, 255, 0)' }],
      'the highlight was not restored after a reload');
  });

  it('opens the popup and reaches settings from it', async () => {
    // A driver cannot navigate to moz-extension:// - the extension has to open
    // its own page, the way the toolbar button would.
    await harness.inExtension(function (done) {
      browser.tabs.create({ url: browser.runtime.getURL('popup.html') })
        .then(() => done(true), error => done(String(error && error.message)));
    });

    const popup = await harness.findTab(url => url.includes('/popup.html'));
    assert.ok(popup, 'the popup page never opened');

    const expectedTitle = await harness.inExtension(function (done) {
      done(browser.i18n.getMessage('popupTitle'));
    });
    await harness.driver.switchTo().window(popup);

    // popup.html carries the English strings as static markup and popup.js
    // swaps them for the locale's on DOMContentLoaded, in the same pass that
    // registers the settings click. Reading either before that finishes tests
    // the markup rather than the popup: on an English browser the heading
    // matches without a line of script having run, and on any other one it
    // matches only if the timing happens to work out.
    assert.ok(await harness.waitForPageReady(), 'the popup never finished loading');

    const heading = await harness.driver.findElement(By.css('h1')).getText();
    assert.equal(heading, expectedTitle);

    await harness.driver.findElement(By.css('#open-settings')).click();
    // The popup closes itself here, so step off its handle before looking for
    // the settings tab; commands to a closed tab hang instead of failing.
    await harness.driver.switchTo().window(harness.pageTab);

    const settings = await harness.findTab(url => url.includes('/settings.html'));
    assert.ok(settings, 'the settings page did not open from the popup');
  });
});
