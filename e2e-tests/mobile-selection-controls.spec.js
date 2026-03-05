import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, selectTextInElement } from './fixtures';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function enableSelectionControls(background) {
  await background.evaluate(async () => {
    await new Promise((resolve) => {
      chrome.storage.local.set({ selectionControlsVisible: true }, resolve);
    });
  });
}

async function showSelectionIconForText(page, textToSelect) {
  const paragraph = page.locator('p:has-text("This is a sample paragraph")');
  await selectTextInElement(paragraph, textToSelect);

  const box = await paragraph.boundingBox();
  await paragraph.dispatchEvent('mouseup', {
    clientX: box.x + 50,
    clientY: box.y + 10,
    bubbles: true
  });

  const selectionIcon = page.locator('.text-highlighter-selection-icon');
  await expect(selectionIcon).toBeVisible();
  return selectionIcon;
}

async function openSelectionControlsWithTouchPointerDown(selectionIcon) {
  const iconBox = await selectionIcon.boundingBox();
  const x = iconBox.x + iconBox.width / 2;
  const y = iconBox.y + iconBox.height / 2;

  await selectionIcon.evaluate((node, point) => {
    const pointerDown = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: point.x,
      clientY: point.y
    });
    node.dispatchEvent(pointerDown);
  }, { x, y });
  return { x, y };
}

async function openSelectionControlsWithClickOnly(selectionIcon) {
  const iconBox = await selectionIcon.boundingBox();
  const x = iconBox.x + iconBox.width / 2;
  const y = iconBox.y + iconBox.height / 2;

  await selectionIcon.evaluate((node, point) => {
    node.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: point.x,
      clientY: point.y
    }));
  }, { x, y });
  return { x, y };
}

async function isPointInsideSelectionControls(page, point) {
  return await page.evaluate((coords) => {
    const controls = document.querySelector('.text-highlighter-selection-controls');
    if (!controls) return false;
    const rect = controls.getBoundingClientRect();
    return coords.x >= rect.left &&
      coords.x <= rect.right &&
      coords.y >= rect.top &&
      coords.y <= rect.bottom;
  }, point);
}

test.describe('Mobile Selection Controls Regression', () => {
  test('Controls should overlap icon point after touch-open', async ({ page, background }) => {
    await enableSelectionControls(background);
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    await page.waitForTimeout(200);

    const selectionIcon = await showSelectionIconForText(page, 'sample paragraph');
    const iconCenter = await openSelectionControlsWithTouchPointerDown(selectionIcon);

    const selectionControls = page.locator('.text-highlighter-selection-controls');
    await expect(selectionControls).toBeVisible();
    const isInside = await isPointInsideSelectionControls(page, iconCenter);
    expect(isInside).toBeTruthy();
  });

  test('Second outside click should still close selection controls', async ({ page, background }) => {
    await enableSelectionControls(background);
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    await page.waitForTimeout(200);

    const selectionIcon = await showSelectionIconForText(page, 'sample paragraph');
    await openSelectionControlsWithTouchPointerDown(selectionIcon);

    const selectionControls = page.locator('.text-highlighter-selection-controls');
    await expect(selectionControls).toBeVisible();

    await page.evaluate(() => {
      document.body.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: 5,
        clientY: 5
      }));
    });

    await expect(selectionControls).toBeHidden();
  });

  test('Should not re-show selection icon on touchend while selection controls are open', async ({ page, background }) => {
    await enableSelectionControls(background);
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    await page.waitForTimeout(200);

    const selectionIcon = await showSelectionIconForText(page, 'sample paragraph');
    await openSelectionControlsWithTouchPointerDown(selectionIcon);

    const selectionControls = page.locator('.text-highlighter-selection-controls');
    await expect(selectionControls).toBeVisible();

    await page.evaluate(() => {
      document.body.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }));
    });

    await page.waitForTimeout(350);
    await expect(page.locator('.text-highlighter-selection-icon')).toHaveCount(0);
    await expect(selectionControls).toBeVisible();
  });

  test('Controls should overlap icon point on click fallback open', async ({ page, background }) => {
    await enableSelectionControls(background);
    await page.goto(`file:///${path.join(__dirname, 'test-page.html')}`);
    await page.waitForTimeout(200);

    const selectionIcon = await showSelectionIconForText(page, 'sample paragraph');
    const iconCenter = await openSelectionControlsWithClickOnly(selectionIcon);

    const selectionControls = page.locator('.text-highlighter-selection-controls');
    await expect(selectionControls).toBeVisible();
    const isInside = await isPointInsideSelectionControls(page, iconCenter);
    expect(isInside).toBeTruthy();
  });
});
