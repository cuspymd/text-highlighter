import { test as base, chromium } from '@playwright/test';
import path from 'path';

export const test = base.extend({
  context: async ({ }, use) => {
    const pathToExtension = path.join(__dirname, '../');
    const context = await chromium.launchPersistentContext('', {
      //headless: false,
      channel: 'chromium',
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

export async function sendHighlightMessage(background, color) {
  await background.evaluate(async (color) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'highlight',
        color
      });
    } else {
      console.error('Active tab not found to send highlight message.');
    }
  }, color);
}

export async function expectHighlightSpan(spanLocator, { color, text }) {
  await expect(spanLocator).toBeVisible();
  await expect(spanLocator).toHaveCSS('background-color', color);
  if (typeof text === 'string') {
    await expect(spanLocator).toHaveText(text.trim());
  }
}