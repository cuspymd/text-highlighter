const path = require('path');
import { test, expect } from './fixtures';

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
});
