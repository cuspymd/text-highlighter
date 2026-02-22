import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { test, expect, sendHighlightMessage, expectHighlightSpan } from './fixtures';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper to open the extension's pages-list.html
async function openPagesList(page, extensionId) {
  const url = `chrome-extension://${extensionId}/pages-list.html`;
  await page.goto(url);
}

async function acceptModalAndGetMessage(page) {
  const modal = page.locator('.custom-modal');
  await expect(modal).toBeVisible();
  const message = ((await page.locator('.modal-content p').textContent()) || '').trim();
  await page.locator('.modal-confirm').click();
  return message;
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

    // 5. Click deleteAllPages button and confirm in custom modal
    const deleteAllBtn = listPage.locator('.btn-delete-all');
    await expect(deleteAllBtn).toBeVisible();
    await deleteAllBtn.click();
    const confirmBtn = listPage.locator('.modal-confirm');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 6. Verify no pages are listed
    await expect(listPage.locator('.page-item')).toHaveCount(0);
    await expect(listPage.locator('#no-pages')).toBeVisible();
    await listPage.close();
  });

  test('should show custom confirm modal when deleting a single page and delete only after confirm', async ({ context, background, extensionId }) => {
    const page1 = await context.newPage();
    await page1.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    const firstParagraph1 = page1.locator('p').first();
    await firstParagraph1.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'yellow');

    const page2 = await context.newPage();
    await page2.goto(`file:///${path.join(__dirname, 'test-page2.html')}`);
    const firstParagraph2 = page2.locator('p').first();
    await firstParagraph2.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'yellow');

    const listPage = await context.newPage();
    await openPagesList(listPage, extensionId);

    const pageItems = listPage.locator('.page-item');
    await expect(pageItems).toHaveCount(2);

    const firstDeleteBtn = pageItems.first().locator('.btn-delete');
    await firstDeleteBtn.click();

    const modal = listPage.locator('.custom-modal');
    await expect(modal).toBeVisible();
    const cancelBtn = listPage.locator('.modal-cancel');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();
    await expect(modal).toHaveCount(0);
    await expect(pageItems).toHaveCount(2);

    await firstDeleteBtn.click();
    const confirmBtn = listPage.locator('.modal-confirm');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    await expect(pageItems).toHaveCount(1);
    await listPage.close();
  });

  test('Verify export highlights behavior after highlighting h1 on test-page.html and h2 on test-page3.html', async ({ context, background, extensionId }) => {
    // 1. test-page.html: h1 highlight (yellow)
    const page1 = await context.newPage();
    await page1.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    const h1 = page1.locator('h1');
    const h1Text = await h1.textContent();
    await h1.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'yellow');
    const h1Span = h1.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h1Span, { color: 'rgb(255, 255, 0)', text: h1Text });

    // 2. test-page3.html: h2 highlight (green)
    const page3 = await context.newPage();
    await page3.goto(`file:///${path.join(__dirname, 'test-page3.html')}`);
    const h2 = page3.locator('h2').first();
    const h2Text = await h2.textContent();
    await h2.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'green');
    const h2Span = h2.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h2Span, { color: 'rgb(0, 128, 0)', text: h2Text });

    // 3. Click export button in pages-list.html
    const listPage = await context.newPage();
    await openPagesList(listPage, extensionId);
    const [download] = await Promise.all([
      listPage.waitForEvent('download'),
      listPage.click('#export-all-btn'),
    ]);
    const downloadPath = await download.path();
    const exported = JSON.parse(fs.readFileSync(downloadPath, 'utf-8'));

    // 4. Verify that the exported data includes highlights from both pages
    const exportedPages = exported.pages;
    expect(exportedPages.length).toBeGreaterThanOrEqual(2);
    const pageHtmlNames = exportedPages.map(p => p.url || p.title || '');
    const hasTestPage = pageHtmlNames.some(name => name.includes('test-page.html'));
    const hasTestPage3 = pageHtmlNames.some(name => name.includes('test-page3.html'));
    expect(hasTestPage).toBeTruthy();
    expect(hasTestPage3).toBeTruthy();
    const allHighlights = exportedPages.flatMap(page => page.highlights);
    const texts = allHighlights.map(h => h.text.trim());
    const colors = allHighlights.map(h => h.color);
    expect(texts).toContain(h1Text.trim());
    expect(texts).toContain(h2Text.trim());
    expect(colors).toContain('yellow');
    expect(colors).toContain('green');
  });

  test('Verify that highlights from test-page.html and test-page3.html are both included in the export', async ({ context, background, extensionId }) => {
    // 1. test-page.html: h1 highlight (yellow)
    const page1 = await context.newPage();
    await page1.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    const h1 = page1.locator('h1');
    const h1Text = await h1.textContent();
    await h1.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'yellow');
    const h1Span = h1.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h1Span, { color: 'rgb(255, 255, 0)', text: h1Text });

    // 2. test-page3.html: h2 highlight (green)
    const page3 = await context.newPage();
    await page3.goto(`file:///${path.join(__dirname, 'test-page3.html')}`);
    const h2 = page3.locator('h2').first();
    const h2Text = await h2.textContent();
    await h2.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'green');
    const h2Span = h2.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h2Span, { color: 'rgb(0, 128, 0)', text: h2Text });

    // 3. Click export button in pages-list.html
    const listPage = await context.newPage();
    await openPagesList(listPage, extensionId);
    const [download] = await Promise.all([
      listPage.waitForEvent('download'),
      listPage.click('#export-all-btn'),
    ]);
    const downloadPath = await download.path();
    const exported = JSON.parse(fs.readFileSync(downloadPath, 'utf-8'));

    // 4. Verify that the exported data includes highlights from both pages
    const exportedPages = exported.pages;
    expect(exportedPages.length).toBeGreaterThanOrEqual(2);
    const pageHtmlNames = exportedPages.map(p => p.url || p.title || '');
    const hasTestPage = pageHtmlNames.some(name => name.includes('test-page.html'));
    const hasTestPage3 = pageHtmlNames.some(name => name.includes('test-page3.html'));
    expect(hasTestPage).toBeTruthy();
    expect(hasTestPage3).toBeTruthy();
    const allHighlights = exportedPages.flatMap(page => page.highlights);
    const texts = allHighlights.map(h => h.text.trim());
    const colors = allHighlights.map(h => h.color);
    expect(texts).toContain(h1Text.trim());
    expect(texts).toContain(h2Text.trim());
    expect(colors).toContain('yellow');
    expect(colors).toContain('green');
  });

  test('Verify that pages are displayed in the list after importing all-highlights-test.json', async ({ context, extensionId }) => {
    // 1. Open pages-list.html (Storage is initialized in a new context)
    const listPage = await context.newPage();
    await openPagesList(listPage, extensionId);

    // 2. Select file after clicking import button
    const importBtn = listPage.locator('#import-btn');
    await expect(importBtn).toBeVisible();

    const jsonPath = path.join(__dirname, 'all-highlights-test.json');

    // Set file after opening file input by clicking importBtn
    await importBtn.click();
    await listPage.setInputFiles('#import-file', jsonPath);
    await acceptModalAndGetMessage(listPage);

    // 3. Verify that there are 2 or more page items after import is complete
    const pageItems = listPage.locator('.page-item');
    await expect(pageItems).toHaveCount(2);

    // 4. Check if each page URL text is included
    const urls = await pageItems.locator('.page-url').allTextContents();
    expect(urls.some(u => u.includes('test-page.html'))).toBeTruthy();
    expect(urls.some(u => u.includes('test-page2.html'))).toBeTruthy();

    await listPage.close();
  });

  test('Verify that only safe URLs are imported when importing JSON containing unsafe URLs', async ({ context, extensionId }) => {
    const listPage = await context.newPage();
    await openPagesList(listPage, extensionId);

    const importBtn = listPage.locator('#import-btn');
    await expect(importBtn).toBeVisible();

    const jsonPath = path.join(__dirname, 'import-mixed-unsafe-urls.json');
    await importBtn.click();
    await listPage.setInputFiles('#import-file', jsonPath);
    const modalMessages = [
      await acceptModalAndGetMessage(listPage),
      await acceptModalAndGetMessage(listPage),
    ];

    // Only 1 safe URL (test-page.html) should be imported
    const pageItems = listPage.locator('.page-item');
    await expect(pageItems).toHaveCount(1);

    const urls = await pageItems.locator('.page-url').allTextContents();
    expect(urls.some(u => u.includes('test-page.html'))).toBeTruthy();

    // Check if unsafe URL skip alert was displayed
    expect(modalMessages.some(m => m.includes('2'))).toBeTruthy();

    await listPage.close();
  });

  test('Verify that import is blocked when all URLs in JSON are unsafe', async ({ context, extensionId }) => {
    const listPage = await context.newPage();
    await openPagesList(listPage, extensionId);

    const importBtn = listPage.locator('#import-btn');
    await expect(importBtn).toBeVisible();

    const jsonPath = path.join(__dirname, 'import-all-unsafe-urls.json');
    await importBtn.click();
    await listPage.setInputFiles('#import-file', jsonPath);
    const modalMessages = [
      await acceptModalAndGetMessage(listPage),
      await acceptModalAndGetMessage(listPage),
    ];

    // No pages should be imported
    await expect(listPage.locator('.page-item')).toHaveCount(0);
    await expect(listPage.locator('#no-pages')).toBeVisible();

    // Check if 2 unsafe URL related alerts were displayed (skipped + all unsafe)
    expect(modalMessages.length).toBe(2);

    await listPage.close();
  });

  test('Verify that import partially succeeds when JSON includes schema-invalid pages', async ({ context, extensionId }) => {
    const listPage = await context.newPage();
    await openPagesList(listPage, extensionId);

    const importBtn = listPage.locator('#import-btn');
    await expect(importBtn).toBeVisible();

    const jsonPath = path.join(__dirname, 'import-mixed-schema-invalid.json');
    await importBtn.click();
    await listPage.setInputFiles('#import-file', jsonPath);
    const modalMessages = [
      await acceptModalAndGetMessage(listPage),
      await acceptModalAndGetMessage(listPage),
    ];

    // Only valid page should be imported
    const pageItems = listPage.locator('.page-item');
    await expect(pageItems).toHaveCount(1);

    const urls = await pageItems.locator('.page-url').allTextContents();
    expect(urls.some(u => u.includes('test-page.html'))).toBeTruthy();
    expect(urls.some(u => u.includes('test-page2.html'))).toBeFalsy();

    // Schema warning + success alerts
    expect(modalMessages.length).toBe(2);

    await listPage.close();
  });
});
