# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a cross-browser extension called "Marks: Text Highlighter" that allows users to highlight text on web pages with multiple colors, manage highlights, and view them via a minimap interface. The extension supports keyboard shortcuts, context menus, and multilingual localization (English, Korean, Japanese, Chinese).

## Essential Commands

### Testing
- `npx playwright test` - Run E2E tests using Playwright (primary testing method)
- `npm test` - Run Jest unit tests (environment configured but no tests written yet)

### Development Builds
- `npm run deploy` - Build extension for Chrome by copying files to `dist/` directory
- `npm run deploy:firefox` - Build extension for Firefox by copying files to `dist-firefox/` directory

### Production Builds
- `npm run version-deploy <version>` - Updates manifest versions, sets DEBUG_MODE to false, builds for Chrome, and creates zip file in `outputs/` directory
- Example: `npm run version-deploy 1.2.0`

### Loading Extensions
- **Chrome**: Load `dist/` directory as unpacked extension via chrome://extensions
- **Firefox**: Load `dist-firefox/manifest.json` as temporary add-on via about:debugging

## Architecture

### Core Components

**Background Script** (`background.js`)
- Service worker that manages extension lifecycle
- Handles context menus, keyboard shortcuts, and storage operations
- Manages custom colors and communicates with content scripts
- Debug mode controlled by `DEBUG_MODE` constant

**Content Script** (`content.js`)
- Injected into all web pages to handle text highlighting
- Manages highlight creation, persistence, and removal
- Loads saved highlights on page load
- Coordinates with minimap and controls

**Popup Interface** (`popup.js`, `popup.html`)
- Extension popup for highlight management
- Shows highlights per page with editing capabilities
- Supports custom color addition and clearing

**Minimap System** (`minimap.js`)
- Visual representation of highlights on page
- Shows highlight positions as colored markers
- Implemented as a singleton MinimapManager class

**Highlight Controls** (`controls.js`)
- In-page UI for highlight color changes and deletion
- Dynamically created control buttons for each color
- Handles color picker for custom colors

### Key Files

- `pages-list.js` - Manages list of pages with highlights
- `manifest.json` - Extension configuration with permissions and commands
- `_locales/` - Internationalization files (en, ja, ko, zh)
- `e2e-tests/` - Playwright test files
- `scripts/deploy.js` - Deployment script

### Cross-Browser Compatibility Architecture

The extension uses a `browserAPI` compatibility layer instead of webextension-polyfill:

```javascript
const browserAPI = (() => {
  if (typeof browser !== 'undefined') {
    return browser;  // Firefox native
  }
  if (typeof chrome !== 'undefined') {
    return chrome;   // Chrome native
  }
  throw new Error('Neither browser nor chrome API is available');
})();
```

- **Chrome**: Uses native `chrome.*` APIs directly
- **Firefox**: Uses native `browser.*` APIs directly
- **Manifests**: Separate manifest files for browser-specific configurations
  - `manifest.json`: Chrome-optimized
  - `manifest-firefox.json`: Firefox-optimized

### Storage Architecture

- Uses `browserAPI.storage.local` for highlight data
- Highlights stored by URL as key with array of highlight groups
- Metadata stored with `${url}_meta` suffix containing title and lastUpdated
- Custom colors stored in `customColors` array
- Each highlight group has: `groupId`, `color`, `text`, `spans[]` with position data

### Message Communication Flow

1. **Background ↔ Content**: Highlight creation, color updates, storage operations
2. **Background ↔ Popup**: Page data retrieval, bulk operations
3. **Content → Controls**: UI interaction for highlight modification
4. **Content → Minimap**: Position updates for visual representation

### Debug Mode

Debug logging is controlled by `DEBUG_MODE` constants in each file. Set to `true` for development debugging.

### Testing Structure

- **Primary testing**: Playwright E2E tests in `e2e-tests/` directory
- Jest unit test environment configured with jsdom but no unit tests written yet
- Mock Chrome APIs available in `mocks/chrome.js`
- Test fixtures in `e2e-tests/fixtures.js`