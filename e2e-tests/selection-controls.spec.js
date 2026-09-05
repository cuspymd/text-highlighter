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

  // One-click highlighting, the setting a user turns on when the palette step is
  // the part they want gone. Driven the way they would drive it: the switch in
  // the settings page, then presses on the icon. The palette is still there
  // afterwards - on the highlight the press just made - which is what keeps
  // colour choice alive on a touch screen, where hover and long-press never were.
  test('Should paint with the last used colour in one click, and still reach the palette afterwards', async ({ page, context, background, extensionId }) => {
    await enableSelectionControls(background);

    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${extensionId}/settings.html`);
    const oneClickToggle = settings.locator('#one-click-highlight-toggle');
    await expect(oneClickToggle).not.toBeChecked();
    // The checkbox itself is the hidden half of the switch; the slider is what a
    // user presses.
    await settings.locator('#one-click-highlight-row .toggle-slider').click();
    await expect(oneClickToggle).toBeChecked();
    await settings.close();

    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    await page.waitForTimeout(200);

    const yellowRgb = 'rgb(255, 255, 0)';
    const greenRgb = 'rgb(170, 255, 170)';

    async function raiseIconOver(paragraph, text) {
      await selectTextInElement(paragraph, text);
      const box = await paragraph.boundingBox();
      await paragraph.dispatchEvent('mouseup', {
        clientX: box.x + 50,
        clientY: box.y + 10,
        bubbles: true
      });
      const selectionIcon = page.locator('.text-highlighter-selection-icon');
      await expect(selectionIcon).toBeVisible();
      return selectionIcon;
    }

    // Nothing has been highlighted yet, so the press offers the first palette
    // colour - and says so on the icon before it is pressed.
    const firstParagraph = page.locator('p:has-text("This is a sample paragraph")');
    let selectionIcon = await raiseIconOver(firstParagraph, 'sample paragraph');
    await expect(selectionIcon.locator('.text-highlighter-selection-icon-swatch'))
      .toHaveCSS('background-color', yellowRgb);
    await selectionIcon.click();

    // One press, one highlight - and no palette on the way.
    const firstHighlight = page.locator('span.text-highlighter-extension:has-text("sample paragraph")');
    await expectHighlightSpan(firstHighlight, { color: yellowRgb, text: 'sample paragraph' });
    await expect(page.locator('.text-highlighter-selection-controls')).toBeHidden();
    await expect(selectionIcon).toBeHidden();

    // A colour other than the offered one is not lost: clicking the highlight
    // opens the full palette, and picking there is what the next press remembers.
    await firstHighlight.click();
    const controls = page.locator('.text-highlighter-controls:not(.text-highlighter-selection-controls)');
    await expect(controls).toBeVisible();
    await controls.locator('.text-highlighter-control-button.color-button').nth(1).click();
    await expectHighlightSpan(firstHighlight, { color: greenRgb, text: 'sample paragraph' });

    const secondParagraph = page.locator('p:has-text("Another paragraph")');
    selectionIcon = await raiseIconOver(secondParagraph, 'Another paragraph');
    await expect(selectionIcon.locator('.text-highlighter-selection-icon-swatch'))
      .toHaveCSS('background-color', greenRgb);
    await selectionIcon.click();

    const secondHighlight = page.locator('span.text-highlighter-extension:has-text("Another paragraph")');
    await expectHighlightSpan(secondHighlight, { color: greenRgb, text: 'Another paragraph' });
  });
});
