import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, expectHighlightSpan, selectTextInElement } from './fixtures';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Selection Controls Tests', () => {
  test('Should highlight text using the selection control icon', async ({ page }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const paragraph = page.locator('p:has-text("This is a sample paragraph")');
    const textToSelect = "sample paragraph";

    // 1. Select the text
    await selectTextInElement(paragraph, textToSelect);

    // Simulate mouseup to trigger the icon
    const box = await paragraph.boundingBox();
    // We need to pass clientX/clientY for the icon positioning logic
    await paragraph.dispatchEvent('mouseup', {
      clientX: box.x + 50,
      clientY: box.y + 10,
      bubbles: true
    });

    // 2. Wait for the selection icon to appear
    const selectionIcon = page.locator('.text-highlighter-selection-icon');
    await expect(selectionIcon).toBeVisible();

    // 3. Click the selection icon
    await selectionIcon.click();

    // 4. Wait for the selection controls to appear
    const selectionControls = page.locator('.text-highlighter-selection-controls');
    await expect(selectionControls).toBeVisible();

    // 5. Click the yellow color button (first button)
    const yellowButton = selectionControls.locator('.text-highlighter-control-button.color-button').nth(0);
    await yellowButton.click();

    // 6. Verify that the text is highlighted
    const highlightedSpan = page.locator(`span.text-highlighter-extension:has-text("${textToSelect}")`);
    await expectHighlightSpan(highlightedSpan, { color: 'rgb(255, 255, 0)', text: textToSelect });

    // 7. Verify controls disappear
    await expect(selectionControls).toBeHidden();
    await expect(selectionIcon).toBeHidden();
  });
});
