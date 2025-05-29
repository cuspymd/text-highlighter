const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

// Helper function to get the extension ID
async function getExtensionId(browserContext) {
  console.log('Attempting to retrieve extension ID...');

  // Method 1: From Service Worker URL (most reliable for Manifest V3)
  try {
    // The service worker might take a moment to initialize.
    // manifest.json should specify "background": { "service_worker": "background.js" } or similar
    const serviceWorkerFileName = 'background.js'; // Adjust if your SW file has a different name

    let serviceWorker = browserContext.serviceWorkers().find(sw => sw.url().endsWith(serviceWorkerFileName));

    if (!serviceWorker) {
      console.log(`Service worker (${serviceWorkerFileName}) not found immediately. Waiting for service worker event...`);
      serviceWorker = await browserContext.waitForEvent('serviceworker', {
        timeout: 15000, // Wait up to 15 seconds
        predicate: sw => sw.url().endsWith(serviceWorkerFileName) // Ensure it's our extension's SW
      });
    }

    if (serviceWorker) {
      const swUrl = serviceWorker.url();
      // URL is like: chrome-extension://<ID>/background.js
      const extensionId = swUrl.split('/')[2];
      if (extensionId && extensionId.length === 32) { // Basic validation of ID format (32 lowercase chars)
        console.log(`Extension ID successfully retrieved from Service Worker: ${extensionId}`);
        return extensionId;
      }
      console.warn(`Received an invalid ID ('${extensionId}') from Service Worker URL ('${swUrl}')`);
    } else {
      console.warn(`Service worker (${serviceWorkerFileName}) for the extension was not found.`);
    }
  } catch (e) {
    console.warn(`Error while trying to get Extension ID from Service Worker: ${e.message}`);
  }

  // Method 2: Fallback - Scrape chrome://extensions page (less reliable, use as last resort)
  console.warn('Fallback: Attempting to scrape chrome://extensions page for Extension ID.');
  const page = await browserContext.newPage();
  try {
    await page.goto('chrome://extensions', { waitUntil: 'domcontentloaded', timeout: 10000 });

    // Attempt to ensure Developer Mode is ON. This is highly dependent on Chrome's internal structure.
    try {
      await page.evaluate(() => {
        const manager = document.querySelector('extensions-manager');
        const devModeSwitch = manager?.shadowRoot?.querySelector('extensions-toolbar')?.shadowRoot?.querySelector('#devMode');
        if (devModeSwitch && !devModeSwitch.checked) {
          devModeSwitch.click();
        }
      });
      await page.waitForTimeout(500); // Give UI time to update
    } catch (devError) {
      console.warn(`Could not ensure developer mode is on: ${devError.message}. Proceeding anyway.`);
    }

    // Try to find the extension by name. The name comes from manifest.json.
    // IMPORTANT: Verify this name from your extension's manifest.json file.
    const extensionName = "Text Highlighter"; // Update this if your extension's name is different!

    const foundExtensionId = await page.evaluate((name) => {
      const manager = document.querySelector('extensions-manager');
      if (!manager?.shadowRoot) return null;
      const itemList = manager.shadowRoot.querySelector('extensions-item-list');
      if (!itemList?.shadowRoot) return null;
      const items = itemList.shadowRoot.querySelectorAll('extensions-item');
      for (const item of items) {
        if (item.shadowRoot) {
          const nameEl = item.shadowRoot.querySelector('#name');
          if (nameEl && nameEl.textContent.trim() === name) {
            return item.id;
          }
        }
      }
      // If no match by name, and if only one extension is loaded (common in tests), return its ID.
      if (items.length > 0) { // Check if any items exist
        console.log(`No extension found by name '${name}'. Found ${items.length} items. Returning ID of the first one as a last resort: ${items[0].id}`);
        return items[0].id;
      }
      return null;
    }, extensionName);

    if (foundExtensionId) {
      console.log(`Extension ID retrieved from chrome://extensions scraping: ${foundExtensionId}`);
      return foundExtensionId;
    }

    console.error('Failed to retrieve Extension ID using scraping method.');
    const screenshotPath = path.join(__dirname, 'debug_extensions_page.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`Screenshot of chrome://extensions page saved to: ${screenshotPath}`);
    return null;

  } catch (e) {
    console.error(`Error during chrome://extensions scraping: ${e.message}`);
    if (page && !page.isClosed()) {
      const errorScreenshotPath = path.join(__dirname, 'error_extensions_page.png');
      await page.screenshot({ path: errorScreenshotPath });
      console.log(`Error screenshot of chrome://extensions page saved to: ${errorScreenshotPath}`);
    }
    return null;
  } finally {
    if (page && !page.isClosed()) {
      await page.close();
    }
  }
}

test.describe('Chrome Extension Tests', () => {
  let browser, context, page;

  test.beforeAll(async () => {
    // 확장 프로그램 경로 설정
    const extensionPath = path.join(__dirname, '../');
    
    // 확장 프로그램과 함께 브라우저 실행
    browser = await chromium.launchPersistentContext('', {
      headless: false, // 확장 프로그램 테스트시 headless 모드 사용 불가
      args: [
        `--load-extension=${extensionPath}`,
        '--disable-extensions-except=' + extensionPath,
        '--disable-web-security',
      ]
    });
    
    // 첫 번째 페이지 가져오기
    page = browser.pages()[0] || await browser.newPage();
  });

  test.afterAll(async () => {
    await browser.close();
  });  
  
  test('팝업 테스트', async () => {
    const testPagePath = path.join(__dirname, 'test-page.html');
    await page.goto('file:///' + testPagePath);
    
    // 확장 프로그램 ID 찾기
    const extensionId = await getExtensionId(browser);

    if (!extensionId) {
      throw new Error('Failed to get extension ID. Check console logs and screenshots if any.');
    }
    
    // 팝업 페이지로 직접 이동
    const popupPage = await browser.newPage();
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

  // test('컨텐트 스크립트 테스트', async () => {
  //   // 테스트 페이지로 이동
  //   await page.goto('https://example.com');
    
  //   // 컨텐트 스크립트가 주입되기를 기다림
  //   await page.waitForTimeout(1000);
    
  //   // 컨텐트 스크립트에 의해 추가된 요소 확인
  //   const injectedElement = page.locator('#extension-injected');
  //   await expect(injectedElement).toBeVisible();
  // });

  // test('백그라운드 스크립트와 메시지 패싱 테스트', async () => {
  //   // 테스트 페이지로 이동
  //   await page.goto('https://example.com');
    
  //   // 컨텐트 스크립트에서 백그라운드로 메시지 전송 테스트
  //   const response = await page.evaluate(async () => {
  //     return new Promise((resolve) => {
  //       chrome.runtime.sendMessage(
  //         { action: 'test', data: 'hello' },
  //         (response) => resolve(response)
  //       );
  //     });
  //   });
    
  //   expect(response).toEqual({ success: true, message: 'received' });
  // });

//   test('스토리지 API 테스트', async () => {
//     const extensionId = await getExtensionId(browser);
//     const popupPage = await browser.newPage();
//     await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    
//     // 데이터 저장 테스트
//     await popupPage.evaluate(() => {
//       chrome.storage.local.set({ testKey: 'testValue' });
//     });
    
//     // 데이터 읽기 테스트
//     await page.goto('https://example.com');
//     const storedValue = await page.evaluate(async () => {
//       return new Promise((resolve) => {
//         chrome.storage.local.get(['testKey'], (result) => {
//           resolve(result.testKey);
//         });
//       });
//     });
    
//     expect(storedValue).toBe('testValue');
//     await popupPage.close();
//   });
});

//const { test, expect } = require('@playwright/test');

// test('should highlight selected text on a page', async ({ page }) => {
//   // Listen for console messages from the page
//   page.on('console', msg => {
//     console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
//   });

//   // Navigate to a test page
//   await page.goto('file:///e:/work/text-highlighter/test-page.html');

//   // Select text
//   await page.evaluate(() => {
//     const p = document.querySelector('p');
//     const range = document.createRange();
//     range.selectNodeContents(p);
//     const selection = window.getSelection();
//     selection.removeAllRanges();
//     selection.addRange(range);
//   });

//   // Get the extension's background page.
//   // For Manifest V3 service workers, we might need to wait for it to activate.
//   let backgroundPage;
//   try {
//     // Try to get existing background pages first
//     const pages = page.context().backgroundPages();
//     if (pages.length > 0) {
//       backgroundPage = pages[0];
//     } else {
//       // If no background pages are immediately available, wait for one to appear
//       backgroundPage = await page.context().waitForEvent('backgroundpage', { timeout: 60000 }); // Increase timeout to 60 seconds
//     }
//   } catch (error) {
//     console.error('Failed to get background page:', error);
//     throw error; // Re-throw to fail the test
//   }

//   // Send a message to the content script to trigger highlighting
//   const highlightColor = 'yellow';
//   await backgroundPage.evaluate(async ({ highlightColor }) => {
//     const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
//     const activeTab = tabs[0];

//     if (activeTab && activeTab.id) {
//       chrome.tabs.sendMessage(activeTab.id, {
//         action: 'highlight',
//         color: highlightColor,
//         text: 'This is a sample paragraph'
//       });
//     } else {
//       console.error('No active tab found to send highlight message.');
//     }
//   }, { highlightColor });

//   // Assert that the text is highlighted
//   const highlightedElement = page.locator('p span.text-highlighter-extension');
//   await expect(highlightedElement).toBeVisible();
//   await expect(highlightedElement).toHaveCSS('background-color', 'rgb(255, 255, 0)'); // yellow
// });
