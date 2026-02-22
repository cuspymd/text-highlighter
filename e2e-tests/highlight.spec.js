import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, sendHighlightMessage, expectHighlightSpan, selectTextInElement } from './fixtures';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Chrome Extension Tests', () => {
  test('Apply yellow highlight via context menu after text selection', async ({page, background}) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const paragraph = page.locator('p:has-text("This is a sample paragraph")');
    const textToSelect = "This is a sample paragraph";

    // Find and select the textToSelect string within the p tag.
    await selectTextInElement(paragraph, textToSelect);

    // Check if there is selected text (for debugging)
    const selected = await page.evaluate(() => window.getSelection().toString());
    expect(selected).toBe(textToSelect);

    await sendHighlightMessage(background, 'yellow');

    // Define verification function
    const verifyHighlight = async () => {
      const highlightedSpan = page.locator(`span.text-highlighter-extension:has-text("${textToSelect}")`);
      await expectHighlightSpan(highlightedSpan, { color: 'rgb(255, 255, 0)', text: textToSelect });
    };
    await verifyHighlight(); // Immediately after highlight
    await page.reload();
    await verifyHighlight(); // After refresh
  });

  test('Triple-click the entire first paragraph to highlight in green', async ({ page, background }) => {
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

    // Define verification function
    const verifyHighlight = async () => {
      const highlightedSpan = firstParagraph.locator('span.text-highlighter-extension');
      await expectHighlightSpan(highlightedSpan, { color: 'rgb(170, 255, 170)', text: expectedText });
    };
    await verifyHighlight();
    await page.reload();
    await verifyHighlight();
  });

  test('Triple-click a dynamically generated multi-text node paragraph to highlight - verify full text highlight and single highlight creation', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const multiTextParagraph = page.locator('#dynamic-multi-text');
    const expectedText = "first second third";

    await page.waitForFunction(() => {
      const elem = document.getElementById('dynamic-multi-text');
      return elem && elem.childNodes.length > 1; // Check if multi-text nodes are generated
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
    // Define verification function
    const verifyHighlight = async () => {
      const highlightedSpans = multiTextParagraph.locator('span.text-highlighter-extension');
      await expect(highlightedSpans).toHaveCount(3);
    };
    await verifyHighlight();
    await page.reload();
    await verifyHighlight();
  });

  test('Select all text from h1 and the first p tag, then apply highlight', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    const firstParagraph = page.locator('p').first();
    const h1Text = await h1.textContent();
    const pText = await firstParagraph.textContent();
    const totalText = (h1Text + '\n' + pText).trim();

    await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const p = document.querySelector('p');
      if (!h1 || !p) throw new Error('Could not find h1 or p tag.');
      const h1TextNode = Array.from(h1.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
      const pTextNode = Array.from(p.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
      if (!h1TextNode || !pTextNode) throw new Error('Could not find text node.');
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

    // Define verification function
    const verifyHighlight = async () => {
      const h1Span = h1.locator('span.text-highlighter-extension');
      const pSpan = firstParagraph.locator('span.text-highlighter-extension');
      await expectHighlightSpan(h1Span, { color: 'rgb(255, 255, 0)', text: h1Text });
      await expectHighlightSpan(pSpan, { color: 'rgb(255, 255, 0)', text: pText });
    };
    await verifyHighlight();
    await page.reload();
    await verifyHighlight();
  });

  test('Verify highlight behavior after selecting "This has <strong>inline" text in paragraph with id "inline-element"', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const inlineParagraph = page.locator('#inline-element');
    // "This has " is a text node, "inline" is inside the strong tag
    // The first child node of the strong tag is "inline element" text
    await page.evaluate(() => {
      const p = document.getElementById('inline-element');
      if (!p) throw new Error('Could not find the paragraph with id "inline-element".');
      const textNode = Array.from(p.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.includes('This has'));
      const strong = p.querySelector('strong');
      if (!textNode || !strong) throw new Error('Could not find the text node or <strong> element.');
      const strongTextNode = strong.firstChild;
      // "This has " length: 9, "inline" inside strong length: 6
      const range = document.createRange();
      range.setStart(textNode, 0); // Start of "This has "
      range.setEnd(strongTextNode, 6); // Up to "inline" inside strong
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // Verify that the selected text is "This has inline"
    const selected = await page.evaluate(() => window.getSelection().toString());
    expect(selected).toBe('This has inline');

    await sendHighlightMessage(background, '#FFFF99'); // Light yellow

    // Define verification function
    const verifyHighlight = async () => {
      const highlightedSpans = inlineParagraph.locator('span.text-highlighter-extension');
      await expect(highlightedSpans).toHaveCount(2);
      await expectHighlightSpan(highlightedSpans.nth(0), { color: 'rgb(255, 255, 153)', text: 'This has ' });
      await expectHighlightSpan(highlightedSpans.nth(1), { color: 'rgb(255, 255, 153)', text: 'inline' });
    };
    await verifyHighlight();
    await page.reload();
    await verifyHighlight();
  });

  test('Verify highlight behavior after selecting "element</strong> in text." text in paragraph with id "inline-element"', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const inlineParagraph = page.locator('#inline-element');
    // Select "element" inside the strong tag and the text node " in text." after the strong tag
    await page.evaluate(() => {
      const p = document.getElementById('inline-element');
      const strong = p.querySelector('strong');
      const strongTextNode = strong.firstChild;
      const afterStrongNode = strong.nextSibling;
      const text = strongTextNode.textContent;
      const startIdx = text.indexOf('element');
      if (startIdx === -1) throw new Error('"element" not found in strongTextNode.');
      const range = document.createRange();
      range.setStart(strongTextNode, startIdx); // Start of "element" inside strong
      range.setEnd(afterStrongNode, afterStrongNode.textContent.length); // End of " in text."
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // Verify that the selected text is "element in text."
    const selected = await page.evaluate(() => window.getSelection().toString());
    expect(selected).toBe('element in text.');

    await sendHighlightMessage(background, '#99FFCC'); // Light green

    // Define verification function
    const verifyHighlight = async () => {
      const highlightedSpans = inlineParagraph.locator('span.text-highlighter-extension');
      await expect(highlightedSpans).toHaveCount(2);
      await expectHighlightSpan(highlightedSpans.nth(0), { color: 'rgb(153, 255, 204)', text: 'element' });
      await expectHighlightSpan(highlightedSpans.nth(1), { color: 'rgb(153, 255, 204)', text: ' in text.' });
    };
    await verifyHighlight();
    await page.reload();
    await verifyHighlight();
  });

  test('Triple-click h1 tag to highlight and delete', async ({ page, background }) => {
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

    // Verify that the highlight remains deleted after page refresh
    await page.reload();
    const h1SpanAfterReload = h1.locator('span.text-highlighter-extension');
    await expect(h1SpanAfterReload).toHaveCount(0);
  });

  test('Deleting one of two highlights with the controls delete button should not be restored by sync merge', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    const firstParagraph = page.locator('p').first();

    await h1.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'yellow');
    await expect(h1.locator('span.text-highlighter-extension')).toHaveCount(1);

    await firstParagraph.click({ clickCount: 3 });
    await sendHighlightMessage(background, '#AAFFAA');
    await expect(firstParagraph.locator('span.text-highlighter-extension')).toHaveCount(1);

    const h1Span = h1.locator('span.text-highlighter-extension');
    await h1Span.click();
    const controls = page.locator('.text-highlighter-controls');
    await expect(controls).toBeVisible();
    await controls.locator('.delete-highlight').click();

    // Give sync merge/onChanged a chance to re-apply stale data.
    await page.waitForTimeout(1500);

    const groupCount = await page.evaluate(() => {
      const groups = new Set(
        Array.from(document.querySelectorAll('.text-highlighter-extension'))
          .map(el => el.dataset.groupId)
          .filter(Boolean)
      );
      return groups.size;
    });
    expect(groupCount).toBe(1);

    const currentUrl = page.url();
    const localCount = await background.evaluate(async (url) => {
      const result = await chrome.storage.local.get([url]);
      return Array.isArray(result[url]) ? result[url].length : 0;
    }, currentUrl);
    expect(localCount).toBe(1);
  });

  test('Triple-click h1 tag to highlight and then change color in highlight control UI', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    const h1Text = await h1.textContent();

    await h1.click({ clickCount: 3 });
    const selected = await page.evaluate(() => window.getSelection().toString().trim());
    expect(selected).toBe(h1Text.trim());

    await sendHighlightMessage(background, 'yellow');

    const h1Span = h1.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h1Span, { color: 'rgb(255, 255, 0)', text: h1Text });

    // Click on highlighted text → Show highlight control UI
    await h1Span.click();
    const controls = page.locator('.text-highlighter-controls');
    await expect(controls).toBeVisible();
    await expect(controls).toHaveCSS('display', /flex|block/);

    // Click the green color button in the highlight control UI
    // The green color button is located at the second button position
    const greenBtn = controls.locator('.text-highlighter-color-buttons > .text-highlighter-control-button').nth(1);
    await greenBtn.click();

    await expectHighlightSpan(h1Span, { color: 'rgb(170, 255, 170)', text: h1Text });

    // Verify that the highlight is maintained after page refresh
    await page.reload();
    const h1SpanAfterReload = h1.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h1SpanAfterReload, { color: 'rgb(170, 255, 170)', text: h1Text });
  });

  test('Case where selection range common ancestor and end container are the same', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page2.html')}`);

    const paragraph = page.locator('p');
    const firstLine = 'First line';
    // Simulate the case where selection range common ancestor and end container are the same
    await paragraph.evaluate((p) => {
      // Find the first text node
      const firstTextNode = Array.from(p.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
      if (!firstTextNode) throw new Error('Could not find the first text node.');
      const range = document.createRange();
      range.setStart(firstTextNode, 0);
      range.setEnd(p, 2); // Up to 2 <br> tags before
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // Verify that the selected text is "First line"
    const selected = await page.evaluate(() => window.getSelection().toString().trim());
    expect(selected).toBe(firstLine);

    await sendHighlightMessage(background, 'yellow');

    // Define verification function
    const verifyHighlight = async () => {
      const highlightedSpans = paragraph.locator('span.text-highlighter-extension');
      await expect(highlightedSpans).toHaveCount(1);
      const highlightedText = await highlightedSpans.first().textContent();
      expect(highlightedText.trim()).toBe(firstLine);
      await expectHighlightSpan(highlightedSpans.first(), { color: 'rgb(255, 255, 0)', text: firstLine });
    };
    await verifyHighlight();

    // Verify highlight is maintained after page refresh
    await page.reload();
    const highlightedSpansAfterReload = paragraph.locator('span.text-highlighter-extension');
    await verifyHighlight();
  });

  test('Case where selection range common ancestor and end container are the same 2', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page3.html')}`);

    // Simulate the case where selection range common ancestor and end container are the same
    await page.evaluate(() => {
      const container = document.querySelector('div.section-content.blog-article.card');
      const p = container.querySelector('p');
      const textNode = Array.from(p.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
      if (!textNode) throw new Error('Could not find text node.');
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(container, 13); // endOffset: 13
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // Verify that the selected text is "I wrote."
    const selected = await page.evaluate(() => window.getSelection().toString().trim());
    expect(selected).toBe('I wrote.');

    await sendHighlightMessage(background, 'yellow');

    // Define verification function
    const verifyHighlight = async () => {
      const highlightedSpans = page.locator('p span.text-highlighter-extension');
      await expect(highlightedSpans).toHaveCount(1);
      const highlightedText = await highlightedSpans.first().textContent();
      expect(highlightedText.trim()).toBe('I wrote.');
      await expectHighlightSpan(highlightedSpans.first(), { color: 'rgb(255, 255, 0)', text: 'I wrote.' });
    };
    await verifyHighlight();

    // Verify highlight is maintained after page refresh
    await page.reload();
    const highlightedSpansAfterReload = page.locator('p span.text-highlighter-extension');
    await verifyHighlight();
  });

  test('Triple-click p tag to highlight yellow; after refresh, only "in" within p tag should be highlighted, "in" in h1 should not be highlighted (test-page4.html)', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page4.html')}`);

    const paragraph = page.locator('p');
    const h1 = page.locator('h1');
    const expectedText = 'test text in paragraph';

    // Select the entire paragraph with a triple click
    await paragraph.click({ clickCount: 3 });

    // Verify that the selected text is the entire paragraph
    const selectedText = await page.evaluate(() => {
      const selection = window.getSelection();
      return selection ? selection.toString().replace(/\s+/g, ' ').trim() : '';
    });
    expect(selectedText).toBe(expectedText);

    // Run yellow highlight command
    await sendHighlightMessage(background, 'yellow');

    // Page refresh
    await page.reload();

    // Check if only "in" within p tag is highlighted
    // 1. Find highlighted span with "in" text within p tag
    const inSpanInP = paragraph.locator('span.text-highlighter-extension', { hasText: 'in' });
    await expect(inSpanInP).toHaveCount(1);
    await expectHighlightSpan(inSpanInP, { color: 'rgb(255, 255, 0)', text: ' in ' });

    // 2. "in" text within h1 tag should not have span.text-highlighter-extension
    const inSpanInH1 = h1.locator('span.text-highlighter-extension', { hasText: 'in' });
    await expect(inSpanInH1).toHaveCount(0);
  });

  test('Add and change custom color in highlight control UI after highlighting h1 tag', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    const h1Text = await h1.textContent();

    // Select entire h1 for highlight application
    await h1.click({ clickCount: 3 });

    const selectedText = await page.evaluate(() => window.getSelection().toString().trim());
    expect(selectedText).toBe(h1Text.trim());

    // Apply default yellow highlight
    await sendHighlightMessage(background, 'yellow');

    const h1Span = h1.locator('span.text-highlighter-extension');
    await expectHighlightSpan(h1Span, { color: 'rgb(255, 255, 0)', text: h1Text });

    // Click highlight → Show control UI
    await h1Span.click();
    const controls = page.locator('.text-highlighter-controls');
    await expect(controls).toBeVisible();

    // Click '+' button to open custom color picker
    const addColorBtn = controls.locator('.add-color-button');
    await addColorBtn.click();
    
    // Wait for custom color picker to appear
    const customColorPicker = page.locator('.custom-color-picker');
    await expect(customColorPicker).toBeVisible();
    
    // Click on desired preset color (select a color close to cyan)
    const newColorHex = '#4ECDC4'; // Cyan-like color available in presets
    await customColorPicker.locator(`[data-color="${newColorHex}"]`).click();

    // Wait for control UI to generate the new color button
    const newColorRgb = 'rgb(78, 205, 196)'; // RGB value for #4ECDC4
    await page.waitForFunction((rgb) => {
      const controls = document.querySelector('.text-highlighter-controls');
      return Array.from(controls.querySelectorAll('.color-button')).some(b => getComputedStyle(b).backgroundColor === rgb);
    }, newColorRgb);

    // Click the new color button
    await page.evaluate((rgb) => {
      const controls = document.querySelector('.text-highlighter-controls');
      const btn = Array.from(controls.querySelectorAll('.color-button')).find(b => getComputedStyle(b).backgroundColor === rgb);
      if (btn) btn.click();
    }, newColorRgb);

    // Verify color change
    await expectHighlightSpan(h1Span, { color: newColorRgb, text: h1Text });

    // Verify color is maintained after refresh
    await page.reload();
    const h1SpanAfterReload = page.locator('h1 span.text-highlighter-extension');
    await expectHighlightSpan(h1SpanAfterReload, { color: newColorRgb, text: h1Text });
  });

  test('Re-highlighting part of an already highlighted text should not create overlapping highlights', async ({ page, background }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const paragraph = page.locator('p').first();
    const initialText = "This is a sample paragraph";
    const overlappingText = "sample";

    // 1. Select "This is a sample paragraph" and highlight in yellow
    await selectTextInElement(paragraph, initialText);

    await sendHighlightMessage(background, 'yellow');

    // 2. Verify that 1 highlight is created
    const highlightedSpan = paragraph.locator('span.text-highlighter-extension');
    await expect(highlightedSpan).toHaveCount(1);
    await expectHighlightSpan(highlightedSpan, { color: 'rgb(255, 255, 0)', text: initialText });

    // 3. Re-select "sample" text inside the existing highlight
    await paragraph.evaluate((element, text) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let targetNode = null;
      let targetOffset = -1;

      while (walker.nextNode()) {
        const node = walker.currentNode;
        const nodeText = node.textContent || '';
        const idx = nodeText.indexOf(text);
        if (idx === -1) continue;

        const parentElement = node.parentElement;
        if (parentElement && parentElement.closest('.text-highlighter-extension')) {
          targetNode = node;
          targetOffset = idx;
          break;
        }
      }

      if (!targetNode) {
        throw new Error(`Text "${text}" not found inside existing highlight.`);
      }

      const range = document.createRange();
      range.setStart(targetNode, targetOffset);
      range.setEnd(targetNode, targetOffset + text.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, overlappingText);

    // 4. Run highlight command again (in green)
    await sendHighlightMessage(background, 'green');

    // 5. Verify that no overlapping highlights are created (span count should still be 1)
    const allSpans = paragraph.locator('span.text-highlighter-extension');
    await expect(allSpans).toHaveCount(1);

    // 6. Verify that the color or content of the existing highlight has not changed
    await expectHighlightSpan(highlightedSpan, { color: 'rgb(255, 255, 0)', text: initialText });
  });

});
