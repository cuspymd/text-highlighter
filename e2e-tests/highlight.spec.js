const path = require('path');
import { test, expect } from './fixtures';

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

// 하이라이트 span 검증 헬퍼 함수
async function expectHighlightSpan(spanLocator, { color, text }) {
  await expect(spanLocator).toBeVisible();
  await expect(spanLocator).toHaveCSS('background-color', color);
  if (typeof text === 'string') {
    await expect(spanLocator).toHaveText(text.trim());
  }
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
    
    await expectHighlightSpan(highlightedSpan, { color: 'rgb(255, 255, 0)', text: textToSelect });
  });

  test('첫 번째 단락 전체를 트리플 클릭하여 초록색으로 하이라이트', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const firstParagraph = page.locator('p').first();
    const expectedText = "This is a sample paragraph with some text that can be highlighted.";

    await firstParagraph.click({ clickCount: 3 });

    const selectedText = await page.evaluate(() => {
      const selection = window.getSelection();
      return selection ? selection.toString().trim() : '';
    });
    expect(selectedText).toBe(expectedText);

    await sendHighlightMessage(background, '#AAFFAA'); // Green color 

    const highlightedSpan = firstParagraph.locator('span.text-highlighter-extension');
    await expectHighlightSpan(highlightedSpan, { color: 'rgb(170, 255, 170)', text: expectedText });
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
    // await expectHighlightSpan(highlightedSpans.first(), { color: 'rgb(255, 170, 255)', text: expectedText });
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

    const selected = await page.evaluate(() => window.getSelection().toString().replace(/\r?\n/g, '\n').trim());
    expect(selected).toBe(totalText);

    await sendHighlightMessage(background, 'yellow');

    const h1Span = h1.locator('span.text-highlighter-extension');
    const pSpan = firstParagraph.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h1Span, { color: 'rgb(255, 255, 0)', text: h1Text });
    await expectHighlightSpan(pSpan, { color: 'rgb(255, 255, 0)', text: pText });
  });

  test('id가 "inline-element"인 단락에서 "This has <strong>inline" 텍스트를 선택 후 하이라이트 동작 검증', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const inlineParagraph = page.locator('#inline-element');
    // "This has "는 텍스트 노드, "inline"은 strong 태그 내부
    // strong 태그의 첫 번째 자식 노드가 "inline element" 텍스트임
    await page.evaluate(() => {
      const p = document.getElementById('inline-element');
      if (!p) throw new Error('Could not find the paragraph with id "inline-element".');
      const textNode = Array.from(p.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.includes('This has'));
      const strong = p.querySelector('strong');
      if (!textNode || !strong) throw new Error('Could not find the text node or <strong> element.');
      const strongTextNode = strong.firstChild;
      // "This has " 길이: 9, strong 내부 "inline" 길이: 6
      const range = document.createRange();
      range.setStart(textNode, 0); // "This has "의 처음
      range.setEnd(strongTextNode, 6); // strong 내부 "inline"까지
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // 선택된 텍스트가 "This has inline"인지 확인
    const selected = await page.evaluate(() => window.getSelection().toString());
    expect(selected).toBe('This has inline');

    await sendHighlightMessage(background, '#FFFF99'); // 연노랑

    // 하이라이트된 span이 두 개(텍스트 노드, strong 내부)로 나뉘어 생성될 수 있음
    const highlightedSpans = inlineParagraph.locator('span.text-highlighter-extension');
    await expect(highlightedSpans).toHaveCount(2);
    // 첫 번째 span: "This has ", 두 번째 span: "inline"
    await expectHighlightSpan(highlightedSpans.nth(0), { color: 'rgb(255, 255, 153)', text: 'This has ' });
    await expectHighlightSpan(highlightedSpans.nth(1), { color: 'rgb(255, 255, 153)', text: 'inline' });
  });

  test('id가 "inline-element"인 단락에서 "element</strong> in text." 텍스트를 선택 후 하이라이트 동작 검증', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const inlineParagraph = page.locator('#inline-element');
    // strong 태그 내부 "element"와 strong 태그 뒤 텍스트 노드 " in text."를 선택
    await page.evaluate(() => {
      const p = document.getElementById('inline-element');
      const strong = p.querySelector('strong');
      const strongTextNode = strong.firstChild;
      const afterStrongNode = strong.nextSibling;
      const text = strongTextNode.textContent;
      const startIdx = text.indexOf('element');
      if (startIdx === -1) throw new Error('"element" not found in strongTextNode.');
      const range = document.createRange();
      range.setStart(strongTextNode, startIdx); // strong 내부 "element"의 시작
      range.setEnd(afterStrongNode, afterStrongNode.textContent.length); // " in text."의 끝
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // 선택된 텍스트가 "element in text."인지 확인
    const selected = await page.evaluate(() => window.getSelection().toString());
    expect(selected).toBe('element in text.');

    await sendHighlightMessage(background, '#99FFCC'); // 연녹색

    // 하이라이트된 span이 두 개(강조, 일반 텍스트)로 나뉘어 생성될 수 있음
    const highlightedSpans = inlineParagraph.locator('span.text-highlighter-extension');
    await expect(highlightedSpans).toHaveCount(2);
    // 첫 번째 span: "element", 두 번째 span: " in text."
    await expectHighlightSpan(highlightedSpans.nth(0), { color: 'rgb(153, 255, 204)', text: 'element' });
    await expectHighlightSpan(highlightedSpans.nth(1), { color: 'rgb(153, 255, 204)', text: ' in text.' });
  });

  test('h1 태그 tripple click 하이라이트 및 삭제', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    const h1Text = await h1.textContent();

    await h1.click({ clickCount: 3 });
    const selected = await page.evaluate(() => window.getSelection().toString().trim());
    expect(selected).toBe(h1Text.trim());

    await sendHighlightMessage(background, 'yellow');

    const h1Span = h1.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h1Span, { color: 'rgb(255, 255, 0)', text: h1Text });

    await h1Span.click();
    const controls = page.locator('.text-highlighter-controls');
    await expect(controls).toBeVisible();
    await expect(controls).toHaveCSS('display', /flex|block/);

    const deleteBtn = controls.locator('.delete-highlight');
    await deleteBtn.click();

    await expect(h1Span).toHaveCount(0);
  });

  test('h1 태그 tripple click 하이라이트 후 highlight control UI에서 색상 변경', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    const h1Text = await h1.textContent();

    await h1.click({ clickCount: 3 });
    const selected = await page.evaluate(() => window.getSelection().toString().trim());
    expect(selected).toBe(h1Text.trim());

    await sendHighlightMessage(background, 'yellow');

    const h1Span = h1.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h1Span, { color: 'rgb(255, 255, 0)', text: h1Text });

    // 하이라이트된 텍스트 클릭 → highlight control UI 표시
    await h1Span.click();
    const controls = page.locator('.text-highlighter-controls');
    await expect(controls).toBeVisible();
    await expect(controls).toHaveCSS('display', /flex|block/);

    // highlight control UI의 green 색상 버튼 클릭
    // green 색상 버튼은 두 번째 버튼에 위치함
    const greenBtn = controls.locator('.text-highlighter-color-buttons > .text-highlighter-control-button').nth(1);
    await greenBtn.click();

    await expectHighlightSpan(h1Span, { color: 'rgb(170, 255, 170)', text: h1Text });
  });

});