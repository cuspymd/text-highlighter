const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e-tests',
  timeout: 60 * 1000, // Overall test timeout of 60 seconds
});

console.log('Playwright config loaded. Extension path:', process.cwd());
