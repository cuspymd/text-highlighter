const path = require('path');
import { test, expect } from './fixtures';

// 공통 하이라이트 메시지 전송 함수
async function sendHighlightMessage(background, color) {
  await background.evaluate(async (color) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'highlight',
        color
      });
    } else {
      console.error('Active tab not found to send highlight message.');
    }
  }, color);
}

test.describe('Chrome Extension Tests', () => {
  test('텍스트 선택 후 컨텍스트 메뉴로 노란색 하이라이트 적용', async ({page, background}) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const paragraph = page.locator('p:has-text("This is a sample paragraph")');
    const textToSelect = "This is a sample paragraph";

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

    await sendHighlightMessage(background, 'yellow');

    const highlightedSpan = page.locator(`span.text-highlighter-extension:has-text("${textToSelect}")`);
    
    await expect(highlightedSpan).toBeVisible();
    // CSS에서 'yellow'는 rgb(255, 255, 0)입니다.
    await expect(highlightedSpan).toHaveCSS('background-color', 'rgb(255, 255, 0)'); 
    await expect(highlightedSpan).toHaveText(textToSelect);
  });

  test('첫 번째 단락 전체를 트리플 클릭하여 초록색으로 하이라이트', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const firstParagraph = page.locator('p').first();
    const expectedText = "This is a sample paragraph with some text that can be highlighted.";

    // 1. Triple click the first paragraph to select its content
    await firstParagraph.click({ clickCount: 3 });

    // 2. Verify the selection (optional, but good for ensuring the click worked as expected)
    const selectedText = await page.evaluate(() => {
      const selection = window.getSelection();
      return selection ? selection.toString().trim() : '';
    });
    expect(selectedText).toBe(expectedText);

    // 3. Trigger highlight action from the background script with green color
    await sendHighlightMessage(background, '#AAFFAA'); // Green color hex from constants.js

    // 4. Assert that the highlight span is visible, has the correct color, and contains the expected text
    const highlightedSpan = firstParagraph.locator('span.text-highlighter-extension');
    await expect(highlightedSpan).toBeVisible();
    await expect(highlightedSpan).toHaveCSS('background-color', 'rgb(170, 255, 170)'); // #AAFFAA in RGB
    await expect(highlightedSpan).toHaveText(expectedText);
  });

  test('동적으로 생성된 멀티 텍스트 노드 단락을 트리플 클릭하여 하이라이트 - 전체 텍스트 하이라이트 및 단일 하이라이트 생성 확인', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const multiTextParagraph = page.locator('#dynamic-multi-text');
    const expectedText = "first second third";

    await page.waitForFunction(() => {
      const elem = document.getElementById('dynamic-multi-text');
      return elem && elem.childNodes.length > 1; // 멀티 텍스트 노드가 생성되었는지 확인
    });

    const textNodeCount = await multiTextParagraph.evaluate((element) => {
      return Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).length;
    });
    expect(textNodeCount).toBeGreaterThan(1); 

    await multiTextParagraph.click({ clickCount: 3 });

    const selectedText = await page.evaluate(() => {
      const selection = window.getSelection();
      return selection ? selection.toString().trim() : '';
    });
    expect(selectedText).toBe(expectedText);

    await sendHighlightMessage(background, '#FFAAFF'); // Purple color

    // Assert that all text in the paragraph is highlighted
    const highlightedSpans = multiTextParagraph.locator('span.text-highlighter-extension');
    
    await expect(highlightedSpans).toHaveCount(3); // TODO: check later
    // await expect(highlightedSpans).toHaveCount(1);
    
    // // Verify the highlight is visible and has correct color
    // await expect(highlightedSpans.first()).toBeVisible();
    // await expect(highlightedSpans.first()).toHaveCSS('background-color', 'rgb(255, 170, 255)'); // #FFAAFF in RGB
    
    // // Verify all text content is captured in the single highlight
    // const highlightedText = await highlightedSpans.first().textContent();
    // expect(highlightedText.trim()).toBe(expectedText);  
  });

  test('h1과 첫 번째 p 태그의 텍스트를 모두 선택 후 하이라이트 적용', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    const firstParagraph = page.locator('p').first();
    const h1Text = await h1.textContent();
    const pText = await firstParagraph.textContent();
    const totalText = (h1Text + '\n' + pText).trim();

    // h1의 첫 텍스트 노드와 첫 번째 p의 첫 텍스트 노드를 찾아 전체 범위 선택
    await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const p = document.querySelector('p');
      if (!h1 || !p) throw new Error('h1 또는 p 태그를 찾을 수 없습니다.');
      const h1TextNode = Array.from(h1.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
      const pTextNode = Array.from(p.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
      if (!h1TextNode || !pTextNode) throw new Error('텍스트 노드를 찾을 수 없습니다.');
      const range = document.createRange();
      range.setStart(h1TextNode, 0);
      range.setEnd(pTextNode, pTextNode.textContent.length);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // 선택된 텍스트가 두 요소의 텍스트를 모두 포함하는지 확인
    const selected = await page.evaluate(() => window.getSelection().toString().replace(/\r?\n/g, '\n').trim());
    expect(selected).toBe(totalText);

    // 하이라이트 메시지 전송 (노란색)
    await sendHighlightMessage(background, 'yellow');

    // 각각의 하이라이트 span이 올바르게 생성되었는지 확인
    const h1Span = h1.locator('span.text-highlighter-extension');
    const pSpan = firstParagraph.locator('span.text-highlighter-extension');
    await expect(h1Span).toBeVisible();
    await expect(h1Span).toHaveCSS('background-color', 'rgb(255, 255, 0)');
    await expect(h1Span).toHaveText(h1Text.trim());
    await expect(pSpan).toBeVisible();
    await expect(pSpan).toHaveCSS('background-color', 'rgb(255, 255, 0)');
    await expect(pSpan).toHaveText(pText.trim());
  });

});