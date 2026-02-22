import { test as base, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const test = base.extend({
  context: [async ({ }, use) => {
    const pathToExtension = path.join(__dirname, '../');
    const launchOptions = {
      //headless: false,
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    };
    const maxAttempts = 3;
    let context = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const candidate = await chromium.launchPersistentContext('', launchOptions);
      let background = candidate.serviceWorkers()[0];

      if (!background) {
        try {
          background = await candidate.waitForEvent('serviceworker', { timeout: 15_000 });
        } catch {
          background = candidate.serviceWorkers()[0];
        }
      }

      if (background) {
        context = candidate;
        break;
      }

      await candidate.close();
    }

    if (!context) {
      throw new Error(`Failed to start extension service worker after ${maxAttempts} attempts`);
    }

    await use(context);
    await context.close();
  }, { timeout: 70_000 }],
  background: [async ({ context }, use) => {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    }
    await use(background);
  }, { timeout: 40_000 }],
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

/**
 * Helper function to select a specific text string within a given element.
 * @param {import('@playwright/test').Locator} locator - The Playwright locator for the element.
 * @param {string} textToSelect - The text string to select within the element.
 */
export async function selectTextInElement(locator, textToSelect) {
  await locator.evaluate((element, text) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let fullText = '';

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const nodeText = node.textContent || '';
      if (nodeText.length > 0) {
        textNodes.push({ node, start: fullText.length, end: fullText.length + nodeText.length });
        fullText += nodeText;
      }
    }

    const startOffset = fullText.indexOf(text);
    if (startOffset === -1) {
      throw new Error(`Text "${text}" not found in element for selection.`);
    }

    const endOffset = startOffset + text.length;
    const startInfo = textNodes.find(info => startOffset >= info.start && startOffset < info.end);
    const endInfo = textNodes.find(info => endOffset > info.start && endOffset <= info.end);

    if (!startInfo || !endInfo) {
      throw new Error(`Unable to map "${text}" to text nodes for selection.`);
    }

    const range = document.createRange();
    range.setStart(startInfo.node, startOffset - startInfo.start);
    range.setEnd(endInfo.node, endOffset - endInfo.start);

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, textToSelect);
}
