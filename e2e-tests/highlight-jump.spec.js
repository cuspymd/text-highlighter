import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, sendHighlightMessage, selectTextInElement } from './fixtures';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Asks the active tab to jump the way the shortcut command does. Playwright
// cannot press an extension command's keys, so this starts one step later.
async function sendJump(background, direction) {
  return background.evaluate(async (direction) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.tabs.sendMessage(tab.id, { action: 'jumpToAdjacentHighlight', direction });
  }, direction);
}

test.describe('Highlight navigation shortcuts', () => {
  test('declares the next and previous commands', async ({ background }) => {
    const names = await background.evaluate(async () => (await chrome.commands.getAll()).map(c => c.name));

    expect(names).toEqual(expect.arrayContaining(['navigate_next_highlight', 'navigate_previous_highlight']));
  });

  test('walks the highlights in page order and wraps around', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    // Room between the paragraphs, so each jump has to scroll.
    await page.addStyleTag({ content: 'p { margin-bottom: 1500px; }' });

    const texts = ['This is a sample paragraph', 'Another paragraph'];
    for (const text of texts) {
      await selectTextInElement(page.locator(`p:has-text("${text}")`), text);
      await sendHighlightMessage(background, 'yellow');
      await expect(page.locator(`span.text-highlighter-extension:has-text("${text}")`)).toBeVisible();
    }
    await page.evaluate(() => window.getSelection().removeAllRanges());

    const groupOf = text => page.locator(`span.text-highlighter-extension:has-text("${text}")`)
      .first().getAttribute('data-group-id');
    const [first, second] = [await groupOf(texts[0]), await groupOf(texts[1])];

    const scrollY = () => page.evaluate(() => window.scrollY);

    expect(await sendJump(background, 'next')).toEqual({ success: true, groupId: first });
    expect(await sendJump(background, 'next')).toEqual({ success: true, groupId: second });
    await expect.poll(scrollY).toBeGreaterThan(1000);

    expect(await sendJump(background, 'next')).toEqual({ success: true, groupId: first });
    await expect.poll(scrollY).toBeLessThan(200);

    expect(await sendJump(background, 'previous')).toEqual({ success: true, groupId: second });
  });
});
