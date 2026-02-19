const { defineConfig } = require('@playwright/test');
const os = require('os');
const path = require('path');

const artifactsRoot = process.env.PLAYWRIGHT_ARTIFACTS_DIR
  ? path.resolve(process.env.PLAYWRIGHT_ARTIFACTS_DIR)
  : path.join(os.tmpdir(), 'text-highlighter-playwright');

module.exports = defineConfig({
  testDir: './e2e-tests',
  outputDir: path.join(artifactsRoot, 'test-results'),
  reporter: [['html', { outputFolder: path.join(artifactsRoot, 'playwright-report') }]],
});

console.log('Playwright config loaded. Extension path:', process.cwd());
console.log('Playwright artifacts path:', artifactsRoot);
