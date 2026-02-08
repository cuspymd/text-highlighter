# Marks: Text Highlighter

A cross-browser extension that allows you to highlight and manage text on web pages. Supports Chrome, Firefox, and Firefox for Android.

## Features

- Text Highlighting: Select and highlight text on web pages with multiple colors
- Highlight Management: Manage and review highlighted text per page
- Minimap: View highlighted positions at a glance with a minimap on the right side of the page
- Multilingual Support: Available in English, Korean, Japanese, and Chinese
- Cross-Browser Support: Works on Chrome, Firefox, and Firefox for Android
- Keyboard Shortcuts: Quick highlighting with customizable keyboard shortcuts (desktop only)
- Selection Controls: Floating highlight UI on text selection, ideal for mobile devices

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
- **Firefox**: Manifest V3 with native WebExtensions APIs
- **Firefox for Android**: Manifest V3 with mobile-optimized UI (requires Firefox 120.0+)

#### Firefox Android Notes

On Firefox for Android, the following desktop-only APIs are unavailable and handled gracefully:
- **Context Menus** (`contextMenus`): Not supported. Use the Selection Controls UI instead (enabled by default on mobile).
- **Keyboard Shortcuts** (`commands`): Not supported. Use the Selection Controls UI instead.
- **Windows API** (`windows`): Not supported. The extension uses the Tabs API as a fallback.

The Selection Controls feature (floating highlight icon on text selection) is automatically enabled on mobile devices, providing a touch-friendly alternative to context menus and keyboard shortcuts.

## Development

### Testing

Run E2E tests using Playwright:

```bash
# Install Playwright browsers (required before first run)
npx playwright install

# Run tests
npx playwright test
```

### Testing on Firefox for Android

To test the extension on a real Android device:

#### Prerequisites

1. Install [Firefox for Android](https://play.google.com/store/apps/details?id=org.mozilla.firefox) on your device
2. Enable USB debugging on your Android device (Settings > Developer options > USB debugging)
3. Connect your device via USB and authorize the connection

#### Using web-ext

```bash
# Run on connected Android device
npx web-ext run -t firefox-android --adb-device <device-id> --firefox-apk org.mozilla.firefox -s dist-firefox
```

To find your device ID:
```bash
adb devices
```

#### Using about:debugging

1. On your Android device, open Firefox and go to `about:config`
2. Set `xpcom.debug.remote.enabled` to `true`
3. On your desktop Firefox, go to `about:debugging` > Setup
4. Add your device and connect
5. Load the extension from `dist-firefox/manifest.json`

#### Viewing Logs

```bash
# View extension logs from the Android device
adb logcat -s GeckoConsole
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

The extension uses a `browserAPI` compatibility layer to support Chrome and Firefox:

- **Chrome**: Uses native `chrome.*` APIs directly
- **Firefox (Desktop/Android)**: Uses native `browser.*` APIs directly
- **Manifest Files**: Separate manifests for browser-specific configurations
  - `manifest.json`: Chrome-optimized (default)
  - `manifest-firefox.json`: Firefox-optimized with `gecko` and `gecko_android` settings

#### API Compatibility

| API | Chrome | Firefox Desktop | Firefox Android |
|-----|--------|----------------|-----------------|
| Storage | O | O | O |
| Tabs | O | O | O |
| Runtime | O | O | O |
| Internationalization | O | O | O |
| Context Menus | O | O | X |
| Commands | O | O | X |
| Windows | O | O | X |

On Firefox Android, unavailable APIs are conditionally guarded using `browser.runtime.getPlatformInfo()` to detect the platform at runtime.

## Contribution

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
