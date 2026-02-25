import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, sendHighlightMessage, expectHighlightSpan, selectTextInElement } from './fixtures';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  test('Popup basic test', async ({extensionId, context, page}) => {
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

  test('Select h1 + p, apply yellow highlight, and delete all via clearAllHighlights', async ({ page, context, background, extensionId }) => {
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

  test('Select h1, apply yellow highlight, and delete via popup', async ({ page, context, background, extensionId }) => {
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
    const confirmBtn = popupPage.locator('.modal-confirm');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    await expect(highlightItems).toHaveCount(0);

    const h1Span = h1.locator('span.text-highlighter-extension');
    await expect(h1Span).toHaveCount(0);
  });

  test('Verify that highlight deletion on same URL multi-tab is reflected immediately in all tabs', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    const h1Text = await h1.textContent();

    await h1.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'yellow');

    const primaryH1Span = h1.locator('span.text-highlighter-extension');
    await expectHighlightSpan(primaryH1Span, { color: 'rgb(255, 255, 0)', text: h1Text });

    const secondPage = await context.newPage();
    await secondPage.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const secondaryH1 = secondPage.locator('h1');
    const secondaryH1Span = secondaryH1.locator('span.text-highlighter-extension');
    await expect(secondaryH1Span).toHaveCount(1);

    await page.bringToFront();
    const tabId = await getCurrentTabId(background);
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

    const highlightItems = popupPage.locator('.highlight-item');
    await expect(highlightItems).toHaveCount(1);
    await highlightItems.nth(0).locator('.delete-btn').click();
    const confirmBtn = popupPage.locator('.modal-confirm');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();
    await expect(highlightItems).toHaveCount(0);

    await expect(primaryH1Span).toHaveCount(0);
    await expect(secondaryH1Span).toHaveCount(0);

    await popupPage.close();
    await secondPage.close();
  });

  test('Verify that highlight is displayed in popup after text selection and highlighting', async ({ page, context, background, extensionId }) => {
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


  test('Selection icon display test: Verify icon display when selecting with default enabled state', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    // Add explicit wait to allow for asynchronous initialization (loading settings)
    await page.waitForTimeout(500);

    const firstParagraph = page.locator('p').first();
    await firstParagraph.click({ clickCount: 3 });

    const selected = await page.evaluate(() => window.getSelection().toString());
    expect(selected.trim()).toBe('This is a sample paragraph with some text that can be highlighted.');

    const selectionIcon = page.locator('.text-highlighter-selection-icon');
    await expect(selectionIcon).toBeVisible();
  });

  test('Selection icon display test: Verify icon display when selecting after enabling in popup', async ({ page, context, background, extensionId }) => {
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);

    const selectionControlsToggle = popupPage.locator('#selection-controls-toggle');
    await expect(selectionControlsToggle).toBeAttached();
    // Wait until popup async initialization applies stored/default state.
    await popupPage.waitForFunction(async () => {
      const toggle = document.getElementById('selection-controls-toggle');
      if (!toggle) return false;
      const result = await chrome.storage.local.get(['selectionControlsVisible']);
      const expected = result.selectionControlsVisible !== undefined ? result.selectionControlsVisible : true;
      return toggle.checked === expected;
    });
    await selectionControlsToggle.evaluate((el) => {
      el.checked = true;
      el.dispatchEvent(new Event('change'));
    });

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

  test('Setting change immediate reflection test: Verify popup toggle changes are applied immediately to other open tabs', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    const secondPage = await context.newPage();
    await secondPage.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    await secondPage.waitForTimeout(500);

    const secondParagraph = secondPage.locator('p').first();
    await secondParagraph.click({ clickCount: 3 });
    await expect(secondPage.locator('.text-highlighter-selection-icon')).toBeVisible();

    await page.bringToFront();
    const tabId = await getCurrentTabId(background);
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

    const selectionControlsToggle = popupPage.locator('#selection-controls-toggle');
    await expect(selectionControlsToggle).toBeAttached();
    await selectionControlsToggle.evaluate((el) => {
      el.checked = false;
      el.dispatchEvent(new Event('change'));
    });
    await expect(selectionControlsToggle).not.toBeChecked();
    await popupPage.close();

    await secondPage.bringToFront();
    await secondPage.keyboard.press('Escape');
    await secondPage.locator('body').click();
    await expect(secondPage.locator('.text-highlighter-selection-icon')).toHaveCount(0);

    await secondParagraph.click({ clickCount: 3 });
    await secondPage.waitForTimeout(200);
    await expect(secondPage.locator('.text-highlighter-selection-icon')).toHaveCount(0);

    await secondPage.close();
  });

  test('Add custom color in control UI and then remove via "Delete Custom Colors" in popup', async ({ page, context, background, extensionId }) => {
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

  test('Verify highlight behavior using selection icon', async ({ page, context, background, extensionId }) => {
    // Check selection-controls-toggle after loading popup.html
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);

    const selectionControlsToggle = popupPage.locator('#selection-controls-toggle');
    await expect(selectionControlsToggle).toBeAttached();
    await selectionControlsToggle.evaluate((el) => {
      el.checked = true;
      el.dispatchEvent(new Event('change'));
    });
    await expect(selectionControlsToggle).toBeChecked();

    await popupPage.close();

    // Select h1 tag after loading test-page.html
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    
    const h1 = page.locator('h1');
    const h1Text = await h1.textContent();
    
    await h1.click({ clickCount: 3 });
    
    const selected = await page.evaluate(() => window.getSelection().toString());
    expect(selected.trim()).toBe(h1Text.trim());

    // Verify selection icon display
    const selectionIcon = page.locator('.text-highlighter-selection-icon');
    await expect(selectionIcon).toBeVisible();

    // Click selection icon container (img uses pointer-events: none)
    await selectionIcon.click();

    // Verify control UI display (select element with selection-controls class)
    const controls = page.locator('.text-highlighter-controls.text-highlighter-selection-controls');
    await expect(controls).toBeVisible();

    // Click the first yellow color icon
    const yellowColorButton = controls.locator('.color-button').first();
    await yellowColorButton.click();

    // Verify that the selected area is highlighted
    const highlightedSpan = h1.locator('span.text-highlighter-extension');
    await expectHighlightSpan(highlightedSpan, { color: 'rgb(255, 255, 0)', text: h1Text });
  });

});
