const path = require('path');
import { test, expect } from './fixtures';


test.describe('Chrome Extension Tests', () => {
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

  test('텍스트 선택 후 컨텍스트 메뉴로 노란색 하이라이트 적용', async ({page, background}) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const paragraph = page.locator('p:has-text("This is a sample paragraph")');
    const textToSelect = "a portion of this text";

    // p 태그 내에서 textToSelect 문자열을 찾아 선택합니다.
    await paragraph.evaluate((element, textToSelect) => {
      const textNode = Array.from(element.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.includes(textToSelect));
      if (textNode) {
        const range = document.createRange();
        const startIndex = textNode.textContent.indexOf(textToSelect);
        range.setStart(textNode, startIndex);
        range.setEnd(textNode, startIndex + textToSelect.length);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
      } else {
        throw new Error(`Text "${textToSelect}" not found in element for selection.`);
      }
    }, textToSelect);

    // 선택된 텍스트가 있는지 확인 (디버깅용)
    const selected = await page.evaluate(() => window.getSelection().toString());
    expect(selected).toBe(textToSelect);

    await background.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      chrome.tabs.sendMessage(tab.id, {
        action: 'highlight',
        color: 'yellow' 
      });
    });

    const highlightedSpan = page.locator(`span.text-highlighter-extension:has-text("${textToSelect}")`);
    
    await expect(highlightedSpan).toBeVisible();
    // CSS에서 'yellow'는 rgb(255, 255, 0)입니다.
    await expect(highlightedSpan).toHaveCSS('background-color', 'rgb(255, 255, 0)'); 
    await expect(highlightedSpan).toHaveText(textToSelect);
  });


});