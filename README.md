# Marks: Text Highlighter

A cross-browser extension that allows you to highlight and manage text on web pages. Supports both Chrome and Firefox.

## Features

- Text Highlighting: Select and highlight text on web pages with multiple colors
- Highlight Management: Manage and review highlighted text per page
- Minimap: View highlighted positions at a glance with a minimap on the right side of the page
- Multilingual Support: Available in English, Korean, Japanese, and Chinese
- Cross-Browser Support: Works on both Chrome and Firefox
- Keyboard Shortcuts: Quick highlighting with customizable keyboard shortcuts

## Getting Started

### Prerequisites

- Node.js 22.16.0 or higher
- npm 10.9.0 or higher

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/text-highlighter.git
cd text-highlighter

# Install dependencies
npm install
```

### Browser Support

This extension supports:
- **Chrome**: Manifest V3 with native Chrome APIs
- **Firefox**: Manifest V3 with WebExtensions polyfill for cross-browser compatibility

## Development

### Testing

Run E2E tests using Playwright:

```bash
npx playwright test
```

### Deployment

#### Development Build

##### For Chrome

Run the deployment script to copy only the required files to the dist directory for loading into Chrome:

```bash
npm run deploy
```

To load the deployed extension in Chrome:

1. Open `chrome://extensions` in Chrome browser
2. Enable "Developer mode" in the top right
3. Click "Load unpacked extension"
4. Select the generated `dist` directory

##### For Firefox

Run the Firefox-specific deployment script:

```bash
npm run deploy:firefox
```

To load the deployed extension in Firefox:

1. Open `about:debugging` in Firefox browser
2. Click "This Firefox" in the sidebar
3. Click "Load Temporary Add-on"
4. Select the `manifest.json` file from the generated `dist-firefox` directory

#### Production Build

For creating a production-ready extension package, you can now specify the target browser:

```bash
npm run version-deploy <version> [browser]
```

This command will:
1. Update the version in the appropriate manifest file (`manifest.json` for Chrome, `manifest-firefox.json` for Firefox)
2. Set `DEBUG_MODE` to `false` in all JavaScript files
3. Build the extension to the appropriate directory (`dist/` for Chrome, `dist-firefox/` for Firefox)
4. Create a browser-specific zip file in the `outputs/` directory

##### Chrome Production Build (default)
```bash
npm run version-deploy 1.2.0
# or explicitly
npm run version-deploy 1.2.0 chrome
```

This creates `outputs/text-highlighter-1.2.0-chrome.zip` ready for submission to the Chrome Web Store.

##### Firefox Production Build
```bash
npm run version-deploy 1.2.0 firefox
```

This creates `outputs/text-highlighter-1.2.0-firefox.zip` ready for submission to Firefox Add-ons (AMO).

**Note**: Each browser build uses its own manifest file and output directory, allowing you to maintain separate versions for each browser if needed.

### Technical Implementation

#### Cross-Browser Compatibility

The extension uses the WebExtensions polyfill to ensure compatibility between Chrome and Firefox:

- **Chrome**: Uses native `chrome.*` APIs directly
- **Firefox**: Uses `browser.*` APIs via webextension-polyfill
- **Manifest Files**: Separate manifests for browser-specific optimizations
  - `manifest.json`: Chrome-optimized (default)
  - `manifest-firefox.json`: Firefox-optimized with polyfill inclusion

#### API Compatibility

All major APIs are fully compatible between browsers:
- Storage API (`chrome.storage`/`browser.storage`)
- Context Menus API (`chrome.contextMenus`/`browser.contextMenus`)
- Commands API (`chrome.commands`/`browser.commands`)
- Tabs API (`chrome.tabs`/`browser.tabs`)
- Runtime API (`chrome.runtime`/`browser.runtime`)
- Internationalization API (`chrome.i18n`/`browser.i18n`)

## Contribution

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
