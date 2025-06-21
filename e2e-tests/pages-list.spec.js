import path from 'path';
import { test, expect, sendHighlightMessage, expectHighlightSpan } from './fixtures';

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

  test('test-page.html의 h1, test-page3.html의 h2 하이라이트 후 export highlights 동작 검증', async ({ context, background, extensionId }) => {
    // 1. test-page.html: h1 하이라이트(노란색)
    const page1 = await context.newPage();
    await page1.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    const h1 = page1.locator('h1');
    const h1Text = await h1.textContent();
    await h1.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'yellow');
    const h1Span = h1.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h1Span, { color: 'rgb(255, 255, 0)', text: h1Text });

    // 2. test-page3.html: h2 하이라이트(초록색)
    const page3 = await context.newPage();
    await page3.goto(`file:///${path.join(__dirname, 'test-page3.html')}`);
    const h2 = page3.locator('h2').first();
    const h2Text = await h2.textContent();
    await h2.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'green');
    const h2Span = h2.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h2Span, { color: 'rgb(0, 128, 0)', text: h2Text });

    // 3. pages-list.html에서 export 버튼 클릭
    const listPage = await context.newPage();
    await openPagesList(listPage, extensionId);
    const [download] = await Promise.all([
      listPage.waitForEvent('download'),
      listPage.click('#export-all-btn'),
    ]);
    const fs = require('fs');
    const downloadPath = await download.path();
    const exported = JSON.parse(fs.readFileSync(downloadPath, 'utf-8'));

    // 4. export된 데이터에 두 페이지의 하이라이트가 모두 포함되어 있는지 검증
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

  test('test-page.html와 test-page3.html에서 각각 하이라이트 후 export에 모두 포함되는지 검증', async ({ context, background, extensionId }) => {
    // 1. test-page.html: h1 하이라이트(노란색)
    const page1 = await context.newPage();
    await page1.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    const h1 = page1.locator('h1');
    const h1Text = await h1.textContent();
    await h1.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'yellow');
    const h1Span = h1.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h1Span, { color: 'rgb(255, 255, 0)', text: h1Text });

    // 2. test-page3.html: h2 하이라이트(초록색)
    const page3 = await context.newPage();
    await page3.goto(`file:///${path.join(__dirname, 'test-page3.html')}`);
    const h2 = page3.locator('h2').first();
    const h2Text = await h2.textContent();
    await h2.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'green');
    const h2Span = h2.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h2Span, { color: 'rgb(0, 128, 0)', text: h2Text });

    // 3. pages-list.html에서 export 버튼 클릭
    const listPage = await context.newPage();
    await openPagesList(listPage, extensionId);
    const [download] = await Promise.all([
      listPage.waitForEvent('download'),
      listPage.click('#export-all-btn'),
    ]);
    const fs = require('fs');
    const downloadPath = await download.path();
    const exported = JSON.parse(fs.readFileSync(downloadPath, 'utf-8'));

    // 4. export된 데이터에 두 페이지의 하이라이트가 모두 포함되어 있는지 검증
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

  test('all-highlights-test.json 파일을 import 하여 페이지가 목록에 표시되는지 검증', async ({ context, extensionId }) => {
    // 1. pages-list.html 열기 (저장소는 새 context로 초기화 상태)
    const listPage = await context.newPage();
    await openPagesList(listPage, extensionId);

    // 2. import 버튼 클릭 후 파일 선택
    const importBtn = listPage.locator('#import-btn');
    await expect(importBtn).toBeVisible();

    // 대화상자(Import 성공 alert) 자동 수락
    listPage.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    const jsonPath = path.join(__dirname, 'all-highlights-test.json');

    // importBtn 클릭으로 파일 input 열기 후 파일 설정
    await importBtn.click();
    await listPage.setInputFiles('#import-file', jsonPath);

    // 3. import 완료 후 페이지 아이템이 2개 이상인지 확인
    const pageItems = listPage.locator('.page-item');
    await expect(pageItems).toHaveCount(2);

    // 4. 각 페이지 URL 텍스트 포함 여부 확인
    const urls = await pageItems.locator('.page-url').allTextContents();
    expect(urls.some(u => u.includes('test-page.html'))).toBeTruthy();
    expect(urls.some(u => u.includes('test-page2.html'))).toBeTruthy();

    await listPage.close();
  });
});