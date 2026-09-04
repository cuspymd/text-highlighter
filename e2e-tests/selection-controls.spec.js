import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, expectHighlightSpan, selectTextInElement } from './fixtures';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function enableSelectionControls(background) {
  await background.evaluate(async () => {
    await new Promise((resolve) => {
      chrome.storage.local.set({ selectionControlsVisible: true }, resolve);
    });
  });
}

test.describe('Selection Controls Tests', () => {
  test('Should highlight text using the selection control icon', async ({ page, background }) => {
    await enableSelectionControls(background);
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    await page.waitForTimeout(200);

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
    // Wait for the justShown guard (300ms) to expire before clicking
    await page.waitForTimeout(350);

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

  test('Should add a colour from the selection bar and highlight the selection with it', async ({ page, background }) => {
    await enableSelectionControls(background);
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    await page.waitForTimeout(200);

    const paragraph = page.locator('p:has-text("This is a sample paragraph")');
    const textToSelect = "sample paragraph";

    await selectTextInElement(paragraph, textToSelect);
    const box = await paragraph.boundingBox();
    await paragraph.dispatchEvent('mouseup', {
      clientX: box.x + 50,
      clientY: box.y + 10,
      bubbles: true
    });

    const selectionIcon = page.locator('.text-highlighter-selection-icon');
    await expect(selectionIcon).toBeVisible();
    await selectionIcon.click();

    const selectionControls = page.locator('.text-highlighter-selection-controls');
    await expect(selectionControls).toBeVisible();
    await page.waitForTimeout(350);

    // The '+' opens the picker without disturbing the selection.
    await selectionControls.locator('.add-color-button').click();
    const picker = page.locator('.custom-color-picker');
    await expect(picker).toBeVisible();
    expect(await page.evaluate(() => window.getSelection().toString())).toBe(textToSelect);

    // Dragging across the saturation/value area is what used to start a new
    // page selection and lose the old one.
    const svBox = await picker.locator('.saturation-value-picker').boundingBox();
    await page.mouse.move(svBox.x + 10, svBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(svBox.x + svBox.width - 10, svBox.y + svBox.height / 2, { steps: 5 });
    await page.mouse.up();
    // Clicking the picker's header is a plain click on non-selectable text.
    await picker.locator('.color-picker-header').click();

    expect(await page.evaluate(() => window.getSelection().toString())).toBe(textToSelect);
    await expect(selectionControls).toBeVisible();
    await expect(picker).toBeVisible();

    // Picking a preset adds it to the palette and paints the selection.
    const newColorHex = '#4ECDC4';
    const newColorRgb = 'rgb(78, 205, 196)';
    await picker.locator(`[data-color="${newColorHex}"]`).click();

    const highlightedSpan = page.locator(`span.text-highlighter-extension:has-text("${textToSelect}")`);
    await expectHighlightSpan(highlightedSpan, { color: newColorRgb, text: textToSelect });
    await expect(picker).toBeHidden();
    await expect(selectionControls).toBeHidden();
    await expect(selectionIcon).toBeHidden();

    // The colour joined the palette: the highlight bar offers it.
    await highlightedSpan.click();
    const controls = page.locator('.text-highlighter-controls:not(.text-highlighter-selection-controls)');
    await expect(controls).toBeVisible();
    await page.waitForFunction((rgb) => {
      const bar = document.querySelector('.text-highlighter-controls:not(.text-highlighter-selection-controls)');
      return Array.from(bar.querySelectorAll('.color-button')).some(b => getComputedStyle(b).backgroundColor === rgb);
    }, newColorRgb);

    // And the highlight survives a reload in that colour.
    await page.reload();
    const spanAfterReload = page.locator(`span.text-highlighter-extension:has-text("${textToSelect}")`);
    await expectHighlightSpan(spanAfterReload, { color: newColorRgb, text: textToSelect });
  });
});
