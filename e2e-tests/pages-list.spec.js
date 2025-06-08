import path from 'path';
import { test, expect, sendHighlightMessage } from './fixtures';

// Helper to open the extension's pages-list.html
async function openPagesList(page, extensionId) {
  const url = `chrome-extension://${extensionId}/pages-list.html`;
  await page.goto(url);
}

test.describe('Pages List UI and Delete All Pages', () => {
  test('should show highlighted pages and delete all', async ({ context, background, extensionId }) => {
    // 1. test-page.html: highlight first p
    const page1 = await context.newPage();
    await page1.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    const firstParagraph1 = page1.locator('p').first();
    const textToSelect1 = await firstParagraph1.textContent();
    await firstParagraph1.click({ clickCount: 3 });
    const selected1 = await page1.evaluate(() => window.getSelection().toString().trim());
    expect(selected1).toBe(textToSelect1.trim());
    await sendHighlightMessage(background, 'yellow');

    // 2. test-page2.html: highlight first p
    const page2 = await context.newPage();
    await page2.goto(`file:///${path.join(__dirname, 'test-page2.html')}`);
    const firstParagraph2 = page2.locator('p').first();
    const textToSelect2 = await firstParagraph2.textContent();
    await firstParagraph2.click({ clickCount: 3 });
    const selected2 = await page2.evaluate(() => window.getSelection().toString().trim());
 
    await sendHighlightMessage(background, 'yellow');

    // 3. Open pages-list.html
    const listPage = await context.newPage();
    await openPagesList(listPage, extensionId);

    // 4. Verify both pages are listed
    await expect(listPage.locator('.page-item')).toHaveCount(2);

    // 5. Click deleteAllPages button
    listPage.on('dialog', async dialog => {
      await dialog.accept();
    });

    const deleteAllBtn = listPage.locator('.btn-delete-all');
    await expect(deleteAllBtn).toBeVisible();
    await deleteAllBtn.click();

    // 6. Verify no pages are listed
    await expect(listPage.locator('.page-item')).toHaveCount(0);
    await expect(listPage.locator('#no-pages')).toBeVisible();
    await listPage.close();
  });
}); 