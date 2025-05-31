import { test as base, chromium } from '@playwright/test';
import path from 'path';

export const test = base.extend({
  context: async ({ }, use) => {
    const pathToExtension = path.join(__dirname, '../');
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      //channel: 'chromium',
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });
    await use(context);
    await context.close();
  },
  background: async ({ context }, use) => {
    // for manifest v3:
    let [background] = context.serviceWorkers();
    if (!background)
      background = await context.waitForEvent('serviceworker');

    await use(background);
  },
  extensionId: async ({ background }, use) => {
    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  },
});
export const expect = test.expect;