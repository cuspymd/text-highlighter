const path = require('path');
import { test, expect, sendHighlightMessage, expectHighlightSpan } from './fixtures';

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
});
