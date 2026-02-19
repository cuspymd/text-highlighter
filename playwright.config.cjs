const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e-tests',
  reporter: 'list',
});

console.log('Playwright config loaded. Extension path:', process.cwd());
