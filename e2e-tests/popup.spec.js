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

    // Verify settings button exists
    const settingsBtn = popupPage.locator('#open-settings');
    await expect(settingsBtn).toBeVisible();

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

  test('Click highlight item in popup scrolls page to highlight and closes popup', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    await h1.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'yellow');

    const h1Span = h1.locator('span.text-highlighter-extension');
    await expect(h1Span).toHaveCount(1);

    const tabId = await getCurrentTabId(background);
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

    const highlightItems = popupPage.locator('.highlight-item');
    await expect(highlightItems).toHaveCount(1);
    await expect(highlightItems.nth(0)).toHaveAttribute('role', 'button');

    await highlightItems.nth(0).click();

    // The flash emphasis marks every span in the group with data-highlighted
    await expect(h1Span).toHaveAttribute('data-highlighted', 'true');

    // Successful jump closes the popup
    await expect.poll(() => popupPage.isClosed()).toBe(true);
  });

  test('Highlight missing from the page is marked, and "find again" restores it', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    await h1.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'yellow');
    await expect(h1.locator('span.text-highlighter-extension')).toHaveCount(1);

    const heading = await h1.textContent();

    // Take the text off the page so the highlight genuinely cannot be placed.
    await page.evaluate(() => {
      document.querySelector('h1').textContent = 'Replaced heading';
    });
    await expect(page.locator('span.text-highlighter-extension')).toHaveCount(0);

    const tabId = await getCurrentTabId(background);
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

    const highlightItem = popupPage.locator('.highlight-item').nth(0);
    await expect(highlightItem).toHaveClass(/is-missing/);
    // A missing entry must not advertise itself as a jump target, by mouse or
    // by keyboard
    await expect(highlightItem).not.toHaveAttribute('role', 'button');
    await expect(highlightItem).toHaveAttribute('tabindex', '-1');

    // The note and the button say so in the UI language
    const [missingLabel, retryLabel] = await popupPage.evaluate(
      (keys) => keys.map(key => chrome.i18n.getMessage(key)),
      ['highlightMissingOnPage', 'retryFindHighlight']
    );
    expect(missingLabel).not.toBe('');
    await expect(highlightItem.locator('.missing-note span')).toHaveText(missingLabel);
    await expect(highlightItem.locator('.retry-btn')).toHaveText(retryLabel);

    // Clicking the entry itself does nothing: no jump, and the popup stays put.
    // Click the text, away from the button.
    await highlightItem.locator('.highlight-text').click();
    await expect(page.locator('span.text-highlighter-extension')).toHaveCount(0);
    expect(popupPage.isClosed()).toBe(false);

    // The text turns up afterwards, standing in for content that loads late.
    // Nothing re-runs the restore on its own, so the entry stays missing until
    // the user asks for it.
    await page.evaluate((text) => {
      document.querySelector('h1').textContent = text;
    }, heading);
    await expect(page.locator('span.text-highlighter-extension')).toHaveCount(0);

    await highlightItem.locator('.retry-btn').click();

    await expect(page.locator('span.text-highlighter-extension')).toHaveCount(1);
    await expect.poll(() => popupPage.isClosed()).toBe(true);
  });

  test('Only the highlight the page could not place is marked missing', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    await h1.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'yellow');

    const paragraph = page.locator('p').first();
    await paragraph.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'green');

    await expect(page.locator('span.text-highlighter-extension')).toHaveCount(2);

    // Only the heading's text goes away. The paragraph's highlight is fine, and
    // marking it too would take a working entry away from the user.
    await page.evaluate(() => {
      document.querySelector('h1').textContent = 'Replaced heading';
    });
    await expect(page.locator('span.text-highlighter-extension')).toHaveCount(1);

    const tabId = await getCurrentTabId(background);
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

    await expect(popupPage.locator('.highlight-item')).toHaveCount(2);
    await expect(popupPage.locator('.highlight-item.is-missing')).toHaveCount(1);
    await expect(popupPage.locator('.retry-btn')).toHaveCount(1);

    // The surviving entry keeps everything a normal entry has
    const intact = popupPage.locator('.highlight-item:not(.is-missing)');
    await expect(intact).toHaveAttribute('role', 'button');
    await expect(intact.locator('.missing-note')).toHaveCount(0);

    await popupPage.close();
  });

  test('"Find again" reports failure when the text is gone from the page', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    const h1 = page.locator('h1');
    await h1.click({ clickCount: 3 });
    await sendHighlightMessage(background, 'yellow');
    await expect(h1.locator('span.text-highlighter-extension')).toHaveCount(1);

    // The page no longer contains the highlighted text at all.
    await page.evaluate(() => {
      document.querySelector('h1').textContent = 'Replaced heading';
    });

    const tabId = await getCurrentTabId(background);
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

    const highlightItem = popupPage.locator('.highlight-item').nth(0);
    await expect(highlightItem).toHaveClass(/is-missing/);

    const failureMessage = await popupPage.evaluate(
      (key) => chrome.i18n.getMessage(key),
      'retryFindHighlightFailed'
    );

    await highlightItem.locator('.retry-btn').click();

    await expect(highlightItem.locator('.missing-note span')).toHaveText(failureMessage);
    // A failed retry leaves the popup open so the message can be read
    expect(popupPage.isClosed()).toBe(false);

    await popupPage.close();
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

  test('Selection icon display test: Verify icon display when selecting after enabling in settings', async ({ page, context, background, extensionId }) => {
    const settingsPage = await context.newPage();
    await settingsPage.goto(`chrome-extension://${extensionId}/settings.html`);

    const selectionControlsToggle = settingsPage.locator('#selection-controls-toggle');
    await expect(selectionControlsToggle).toBeAttached();
    // Wait until async initialization applies stored/default state.
    await settingsPage.waitForFunction(async () => {
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

    await settingsPage.close();

    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);

    await page.waitForTimeout(100);
    const firstParagraph = page.locator('p').first();
    await firstParagraph.click({ clickCount: 3 });

    const selected = await page.evaluate(() => window.getSelection().toString());
    expect(selected.trim()).toBe('This is a sample paragraph with some text that can be highlighted.');

    const selectionIcon = page.locator('.text-highlighter-selection-icon');
    await expect(selectionIcon).toBeVisible();
  });

  test('Setting change immediate reflection test: Verify settings toggle changes are applied immediately to other open tabs', async ({ page, context, background, extensionId }) => {
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    const secondPage = await context.newPage();
    await secondPage.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    await secondPage.waitForTimeout(500);

    const secondParagraph = secondPage.locator('p').first();
    await secondParagraph.click({ clickCount: 3 });
    await expect(secondPage.locator('.text-highlighter-selection-icon')).toBeVisible();

    await page.bringToFront();
    const settingsPage = await context.newPage();
    await settingsPage.goto(`chrome-extension://${extensionId}/settings.html`);

    const selectionControlsToggle = settingsPage.locator('#selection-controls-toggle');
    await expect(selectionControlsToggle).toBeAttached();
    await selectionControlsToggle.evaluate((el) => {
      el.checked = false;
      el.dispatchEvent(new Event('change'));
    });
    await expect(selectionControlsToggle).not.toBeChecked();
    await settingsPage.close();

    await secondPage.bringToFront();
    await secondPage.keyboard.press('Escape');
    await secondPage.locator('body').click();
    await expect(secondPage.locator('.text-highlighter-selection-icon')).toHaveCount(0);

    await secondParagraph.click({ clickCount: 3 });
    await secondPage.waitForTimeout(200);
    await expect(secondPage.locator('.text-highlighter-selection-icon')).toHaveCount(0);

    await secondPage.close();
  });

  test('Add custom color in control UI and then remove via settings page', async ({ page, context, background, extensionId }) => {
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

    const settingsPage = await context.newPage();
    await settingsPage.goto(`chrome-extension://${extensionId}/settings.html`);

    // The first colour row's own Remove, not the section's Remove All
    const removeBtn = settingsPage.locator('#custom-colors-list .color-row .btn-danger').first();
    await removeBtn.click();

    // Go back to content page and verify it's removed
    await page.bringToFront();
    await page.waitForFunction((rgb) => {
      const controls = document.querySelector('.text-highlighter-controls');
      return !Array.from(controls.querySelectorAll('.color-button')).some(b => getComputedStyle(b).backgroundColor === rgb);
    }, newColorRgb);

    const colorButtons = controls.locator('.color-button');
    await expect(colorButtons).toHaveCount(5);

    await settingsPage.close();
  });

  test('Verify highlight behavior using selection icon', async ({ page, context, background, extensionId }) => {
    // Check selection-controls-toggle after loading settings.html
    const settingsPage = await context.newPage();
    await settingsPage.goto(`chrome-extension://${extensionId}/settings.html`);

    const selectionControlsToggle = settingsPage.locator('#selection-controls-toggle');
    await expect(selectionControlsToggle).toBeAttached();
    await selectionControlsToggle.evaluate((el) => {
      el.checked = true;
      el.dispatchEvent(new Event('change'));
    });
    await expect(selectionControlsToggle).toBeChecked();

    await settingsPage.close();

    // Select h1 tag after loading test-page.html
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    
    // Add explicit wait to allow for asynchronous initialization (loading settings)
    await page.waitForTimeout(500);

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

    // Wait for the justShown guard (300ms) to expire before clicking
    await page.waitForTimeout(350);

    // Click the first yellow color icon
    const yellowColorButton = controls.locator('.color-button').first();
    await yellowColorButton.click();

    // Verify that the selected area is highlighted
    const highlightedSpan = h1.locator('span.text-highlighter-extension');
    await expectHighlightSpan(highlightedSpan, { color: 'rgb(255, 255, 0)', text: h1Text });
  });

});
