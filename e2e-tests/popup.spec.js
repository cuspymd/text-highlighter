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
    
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    
    const h1Locator = popupPage.locator('h1');

    const expectedH1Text = await popupPage.evaluate(async (key) => {
      return chrome.i18n.getMessage(key);
    }, "popupTitle");

    await expect(h1Locator).toHaveText(expectedH1Text);
    await popupPage.close();
  });

  test('h1 + p 선택, 노란색 하이라이트, clearAllHighlights로 모두 삭제', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    const p = page.locator('p').first();
    const h1Text = await h1.textContent();
    const pText = await p.textContent();

    await h1.click({ clickCount: 3 });

    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Shift');

    const selected = await page.evaluate(() => window.getSelection().toString().replace(/\r?\n/g, '\n').trim());
    const expected = (h1Text + '\n' + pText).trim();
    expect(selected).toBe(expected);

    await sendHighlightMessage(background, 'yellow');

    const h1Span = h1.locator('span.text-highlighter-extension');
    const pSpan = p.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h1Span, { color: 'rgb(255, 255, 0)', text: h1Text });
    await expectHighlightSpan(pSpan, { color: 'rgb(255, 255, 0)', text: pText });

    const tabId = await getCurrentTabId(background);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

    const highlightItems = popupPage.locator('.highlight-item');
    await expect(highlightItems).toHaveCount(1);
    const highlight = await highlightItems.nth(0).textContent();
    expect(highlight.startsWith(h1Text.substring(0, 45))).toBe(true);

    await popupPage.click('#clear-all');
    
    const confirmBtn = popupPage.locator('.modal-confirm');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    await expect(h1Span).toHaveCount(0);
    await expect(pSpan).toHaveCount(0);
  });

  test('h1 선택, 노란색 하이라이트 후 팝업에서 삭제', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    const h1Text = await h1.textContent();

    await h1.click({ clickCount: 3 });

    await sendHighlightMessage(background, 'yellow');

    const tabId = await getCurrentTabId(background);
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

    const highlightItems = popupPage.locator('.highlight-item');
    await expect(highlightItems).toHaveCount(1);
    const highlight0 = await highlightItems.nth(0).textContent();
    expect(highlight0.startsWith(h1Text.substring(0, 45))).toBe(true);

    const deleteBtn = highlightItems.nth(0).locator('.delete-btn');
    await deleteBtn.click();

    await expect(highlightItems).toHaveCount(0);

    const h1Span = h1.locator('span.text-highlighter-extension');
    await expect(h1Span).toHaveCount(0);
  });

  test('텍스트 선택 후 하이라이트, popup에 해당 하이라이트가 표시되는지 검증', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const firstParagraph = page.locator('p').first();
    const textToSelect = 'sample paragraph';

    await selectTextInElement(firstParagraph, textToSelect);

    const selected = await page.evaluate(() => window.getSelection().toString());
    expect(selected).toBe(textToSelect);

    await sendHighlightMessage(background, 'yellow');

    const highlightedSpan = firstParagraph.locator('span.text-highlighter-extension:has-text("sample paragraph")');
    await expectHighlightSpan(highlightedSpan, { color: 'rgb(255, 255, 0)', text: textToSelect });

    const tabId = await getCurrentTabId(background);
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

    const highlightItems = popupPage.locator('.highlight-item');
    await expect(highlightItems).toHaveCount(1);
    const highlightText = await highlightItems.nth(0).textContent();
    expect(highlightText).toContain(textToSelect);
  });


  test('selection icon 표시 테스트: 기본 비활성화 상태에서 선택 후 아이콘 없음 검증', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const firstParagraph = page.locator('p').first();
    await firstParagraph.click({ clickCount: 3 });

    const selected = await page.evaluate(() => window.getSelection().toString());
    expect(selected.trim()).toBe('This is a sample paragraph with some text that can be highlighted.');

    const selectionIcon = page.locator('.text-highlighter-selection-icon');
    await expect(selectionIcon).toHaveCount(0);
  });

  test('selection icon 표시 테스트: popup에서 활성화 후 선택 시 아이콘 표시 검증', async ({ page, context, background, extensionId }) => {
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);

    const selectionControlsToggle = popupPage.locator('#selection-controls-toggle');
    await expect(selectionControlsToggle).toBeVisible();
    await selectionControlsToggle.check();

    await expect(selectionControlsToggle).toBeChecked();

    await popupPage.close();

    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    await page.waitForTimeout(100);
    const firstParagraph = page.locator('p').first();
    await firstParagraph.click({ clickCount: 3 });

    const selected = await page.evaluate(() => window.getSelection().toString());
    expect(selected.trim()).toBe('This is a sample paragraph with some text that can be highlighted.');

    const selectionIcon = page.locator('.text-highlighter-selection-icon');
    await expect(selectionIcon).toBeVisible();
  });

  test('control UI에서 커스텀 색상 추가 후 popup에서 Delete Custom Colors 로 제거', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    const h1Text = await h1.textContent();

    await h1.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'yellow');

    const h1Span = h1.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h1Span, { color: 'rgb(255, 255, 0)', text: h1Text });

    await h1Span.click();
    const controls = page.locator('.text-highlighter-controls');
    await expect(controls).toBeVisible();

    const addColorBtn = controls.locator('.add-color-button');
    await addColorBtn.click();
    
    const customColorPicker = page.locator('.custom-color-picker');
    await expect(customColorPicker).toBeVisible();
    
    const newColorHex = '#4ECDC4';
    await customColorPicker.locator(`[data-color="${newColorHex}"]`).click();

    const newColorRgb = 'rgb(78, 205, 196)';
    await page.waitForFunction((rgb) => {
      const controls = document.querySelector('.text-highlighter-controls');
      return Array.from(controls.querySelectorAll('.color-button')).some(b => getComputedStyle(b).backgroundColor === rgb);
    }, newColorRgb);

    const tabId = await getCurrentTabId(background);
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

    await popupPage.click('#delete-custom-colors');
    
    const confirmBtn = popupPage.locator('.modal-confirm');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();
    
    const okBtn = popupPage.locator('.modal-confirm');
    await expect(okBtn).toBeVisible();
    await okBtn.click();

    await page.waitForFunction((rgb) => {
      const controls = document.querySelector('.text-highlighter-controls');
      return !Array.from(controls.querySelectorAll('.color-button')).some(b => getComputedStyle(b).backgroundColor === rgb);
    }, newColorRgb);

    const colorButtons = controls.locator('.color-button');
    await expect(colorButtons).toHaveCount(5);

    await popupPage.close();
  });

});
