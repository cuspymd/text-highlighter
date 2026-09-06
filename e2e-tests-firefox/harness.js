/**
 * Firefox smoke harness.
 *
 * Firefox add-on E2E cannot go through Playwright: its Firefox never commits a
 * navigation to `moz-extension://`, so the popup and settings pages are out of
 * reach. Selenium plus geckodriver is the one stack that reaches them, which is
 * why this suite is a separate thing from `e2e-tests/` rather than a second
 * project in the Playwright config.
 *
 * Three Firefox rules shape everything below:
 *
 * - `--allow-system-access` (geckodriver 0.36+) is what allows executeScript in
 *   an extension page. Without it geckodriver refuses with "not supported for
 *   privileged browsing contexts", and there is no way to reach `browser.tabs`
 *   or `browser.storage` at all - that page is this suite's stand-in for the
 *   background, which Firefox never exposes to a driver.
 * - The driver may not navigate to `moz-extension://` itself. Extension pages
 *   have to be opened from inside the extension (`browser.tabs.create`). The
 *   guide tab the extension opens on install is the way in.
 * - Content scripts do not run on `file://` in Firefox, so the shared pages in
 *   `e2e-tests/` are served over HTTP here.
 */
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { download } from 'geckodriver';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.join(__dirname, '..', 'dist-firefox');
const PAGES_DIR = path.join(__dirname, '..', 'e2e-tests');

function servePages() {
  const server = http.createServer((req, res) => {
    const name = path.basename((req.url === '/' ? '/test-page.html' : req.url).split('?')[0]);
    fs.readFile(path.join(PAGES_DIR, name), (err, body) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

export async function startHarness() {
  if (!fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'))) {
    throw new Error('dist-firefox is missing. Run `npm run deploy:firefox` first.');
  }

  const { server, port } = await servePages();
  const options = new firefox.Options();
  if (process.env.FIREFOX_BINARY) options.setBinary(process.env.FIREFOX_BINARY);
  if (!process.env.HEADFUL) options.addArguments('-headless');

  const service = new firefox.ServiceBuilder(await download())
    .addArguments('--allow-system-access');

  const driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxService(service)
    .setFirefoxOptions(options)
    .build();
  await driver.manage().setTimeouts({ script: 20_000, pageLoad: 30_000, implicit: 0 });

  const pageTab = (await driver.getAllWindowHandles())[0];
  await driver.installAddon(EXTENSION_DIR, true);

  const harness = {
    driver,
    baseUrl: `http://127.0.0.1:${port}`,
    pageTab,
    extensionTab: null,

    /** Switches to the tab and returns its URL, tolerating tabs that closed themselves. */
    async urlOf(handle) {
      try {
        await driver.switchTo().window(handle);
        return await driver.getCurrentUrl();
      } catch {
        return null;
      }
    },

    /** Polls every open tab until one matches, then leaves the driver on it. */
    async findTab(matches, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        for (const handle of await driver.getAllWindowHandles()) {
          const url = await harness.urlOf(handle);
          if (url && matches(url)) return handle;
        }
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      return null;
    },

    /** Runs privileged code in an extension page - the background stand-in. */
    async inExtension(script, ...args) {
      await driver.switchTo().window(harness.extensionTab);
      return driver.executeAsyncScript(script, ...args);
    },

    async openPage(name) {
      await driver.switchTo().window(harness.pageTab);
      await driver.get(`${harness.baseUrl}/${name}`);
    },

    async inPage(script, ...args) {
      await driver.switchTo().window(harness.pageTab);
      return driver.executeScript(script, ...args);
    },

    /** Polls a page-context script until it returns something truthy. */
    async waitInPage(script, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        last = await harness.inPage(script);
        if (last) return last;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      return last;
    },

    /**
     * Closes everything but the page tab and the guide. The popup closes itself
     * when it opens settings, and commands sent to a tab that is already gone
     * hang rather than fail, so tests must not be left standing on one.
     */
    async closeExtraTabs() {
      for (const handle of await driver.getAllWindowHandles()) {
        if (handle === harness.pageTab || handle === harness.extensionTab) continue;
        try {
          await driver.switchTo().window(handle);
          await driver.close();
        } catch {}
      }
      await driver.switchTo().window(harness.pageTab);
    },

    async stop() {
      await driver.quit().catch(() => {});
      await new Promise(resolve => server.close(resolve));
    },
  };

  harness.extensionTab = await harness.findTab(url => url.includes('/onboarding.html'), 20_000);
  if (!harness.extensionTab) {
    await harness.stop();
    throw new Error('The extension never opened its guide tab, so there is no privileged context to drive it from.');
  }

  return harness;
}
