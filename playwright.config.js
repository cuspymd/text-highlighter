const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e-tests',
  timeout: 60 * 1000, // Overall test timeout of 60 seconds
  use: {
    headless: false, // Set to false to see the browser UI
    // Launch Chromium with the unpacked extension
    launchOptions: {
      args: [
        `--disable-extensions-except=${process.cwd()}`,
        `--load-extension=${process.cwd()}`,
      ],
    },
  },
});

console.log('Playwright config loaded. Extension path:', process.cwd());
