const path = require('path');
import { test, expect, sendHighlightMessage, expectHighlightSpan, selectTextInElement } from './fixtures';

async function getCurrentTabId(background) {
  return await background.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      return tab.id
    } else {
      console.error('Current tab not found');
    }
  });
}

test.describe('Popup Tests', () => {
  test('팝업 테스트', async ({extensionId, context, page}) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    if (!extensionId) {
      throw new Error('Failed to get extension ID. Check console logs and screenshots if any.');
    }
    
    // 팝업 페이지로 직접 이동
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    
    // 팝업 내용 테스트 (현지화된 텍스트 비교)
    const h1Locator = popupPage.locator('h1');

    const expectedH1Text = await popupPage.evaluate(async (key) => {
      return chrome.i18n.getMessage(key);
    }, "popupTitle");

    // 3. 현지화된 텍스트와 비교
    await expect(h1Locator).toHaveText(expectedH1Text);
    await popupPage.close();
  });

  test('h1 + p 선택, 노란색 하이라이트, clearAllHighlights로 모두 삭제', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    const p = page.locator('p').first();
    const h1Text = await h1.textContent();
    const pText = await p.textContent();

    // 1. h1 tripple click
    await h1.click({ clickCount: 3 });

    // 2. 아래 화살표로 p까지 확장 선택
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Shift');

    // 선택된 텍스트가 h1 + p 전체인지 확인
    const selected = await page.evaluate(() => window.getSelection().toString().replace(/\r?\n/g, '\n').trim());
    const expected = (h1Text + '\n' + pText).trim();
    expect(selected).toBe(expected);

    // 3. 노란색 하이라이트 명령 실행
    await sendHighlightMessage(background, 'yellow');

    // 4. 하이라이트가 2개 생성되었는지 검증
    const h1Span = h1.locator('span.text-highlighter-extension');
    const pSpan = p.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h1Span, { color: 'rgb(255, 255, 0)', text: h1Text });
    await expectHighlightSpan(pSpan, { color: 'rgb(255, 255, 0)', text: pText });

    const tabId = await getCurrentTabId(background);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

    // 팝업에 1개의 하이라이트가 표시되는지 검증
    const highlightItems = popupPage.locator('.highlight-item');
    await expect(highlightItems).toHaveCount(1);
    const highlight = await highlightItems.nth(0).textContent();
    expect(highlight.startsWith(h1Text.substring(0, 45))).toBe(true);

    // confirm 다이얼로그 자동 수락
    popupPage.on('dialog', async dialog => {
      await dialog.accept();
    });

    // 5. 팝업의 clear-all 버튼 클릭
    await popupPage.click('#clear-all');

    // 6. 모든 하이라이트가 제거되었는지 검증
    await expect(h1Span).toHaveCount(0);
    await expect(pSpan).toHaveCount(0);
  });

  test('h1 선택, 노란색 하이라이트 후 팝업에서 삭제', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    const h1Text = await h1.textContent();

    // 1. h1 tripple click
    await h1.click({ clickCount: 3 });

    // 2. 노란색 하이라이트 명령 실행
    await sendHighlightMessage(background, 'yellow');

    // 3. popup.html 띄움
    const tabId = await getCurrentTabId(background);
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

    // 4. popup에 하이라이트 표시되고 있는지 검증
    const highlightItems = popupPage.locator('.highlight-item');
    await expect(highlightItems).toHaveCount(1);
    const highlight0 = await highlightItems.nth(0).textContent();
    expect(highlight0.startsWith(h1Text.substring(0, 45))).toBe(true);

    // 5. popup 하이라이트의 delete 버튼 클릭
    const deleteBtn = highlightItems.nth(0).locator('.delete-btn');
    await deleteBtn.click();

    // 6. popup에 하이라이트 표시되지 않음을 검증
    await expect(highlightItems).toHaveCount(0);

    // 7. test-page.html에 하이라이트 표시되지 않음을 검증
    const h1Span = h1.locator('span.text-highlighter-extension');
    await expect(h1Span).toHaveCount(0);
  });

  test('텍스트 선택 후 하이라이트, popup에 해당 하이라이트가 표시되는지 검증', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const firstParagraph = page.locator('p').first();
    const textToSelect = 'sample paragraph';

    // 첫 번째 p 태그 내에서 'sample paragraph'만 선택
    await selectTextInElement(firstParagraph, textToSelect);

    // 선택된 텍스트가 정확히 'sample paragraph'인지 확인
    const selected = await page.evaluate(() => window.getSelection().toString());
    expect(selected).toBe(textToSelect);

    // 하이라이트 명령 실행
    await sendHighlightMessage(background, 'yellow');

    // 하이라이트 span이 생성되었는지 확인
    const highlightedSpan = firstParagraph.locator('span.text-highlighter-extension:has-text("sample paragraph")');
    await expectHighlightSpan(highlightedSpan, { color: 'rgb(255, 255, 0)', text: textToSelect });

    // popup.html에서 하이라이트가 표시되는지 확인
    const tabId = await getCurrentTabId(background);
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

    const highlightItems = popupPage.locator('.highlight-item');
    await expect(highlightItems).toHaveCount(1);
    const highlightText = await highlightItems.nth(0).textContent();
    expect(highlightText).toContain(textToSelect);
  });


  test('control UI에서 커스텀 색상 추가 후 popup에서 Delete Custom Colors 로 제거', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    const h1Text = await h1.textContent();

    // 하이라이트 적용
    await h1.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'yellow');

    const h1Span = h1.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h1Span, { color: 'rgb(255, 255, 0)', text: h1Text });

    // 컨트롤 UI 열기
    await h1Span.click();
    const controls = page.locator('.text-highlighter-controls');
    await expect(controls).toBeVisible();

    // + 버튼으로 새 색상 추가
    const addColorBtn = controls.locator('.add-color-button');
    const newColorHex = '#00FFFF';
    await addColorBtn.locator('input[type="color"]').evaluate((input, color) => {
      input.value = color;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, newColorHex);

    const newColorRgb = 'rgb(0, 255, 255)';
    // 새 버튼이 나타날 때까지 대기
    await page.waitForFunction((rgb) => {
      const controls = document.querySelector('.text-highlighter-controls');
      return Array.from(controls.querySelectorAll('.color-button')).some(b => getComputedStyle(b).backgroundColor === rgb);
    }, newColorRgb);

    // popup.html 열기
    const tabId = await getCurrentTabId(background);
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

    // confirm 자동 수락
    popupPage.on('dialog', async dialog => { await dialog.accept(); });
    await popupPage.click('#delete-custom-colors');

    // 컨트롤 UI에 새 색상 버튼이 사라졌는지 확인
    await page.waitForFunction((rgb) => {
      const controls = document.querySelector('.text-highlighter-controls');
      return !Array.from(controls.querySelectorAll('.color-button')).some(b => getComputedStyle(b).backgroundColor === rgb);
    }, newColorRgb);

    // 기본 색상 5개만 존재하는지 확인
    const colorButtons = controls.locator('.color-button');
    await expect(colorButtons).toHaveCount(5);

    await popupPage.close();
  });



});
