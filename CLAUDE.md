# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome extension called "Marks: Text Highlighter" that allows users to highlight text on web pages with multiple colors, manage highlights, and view them via a minimap interface. The extension supports keyboard shortcuts, context menus, and multilingual localization.

## Essential Commands

### Testing
- `npm test` - Run Jest unit tests
- `npx playwright test` - Run E2E tests using Playwright

### Deployment
- `npm run deploy` - Build extension for Chrome by copying files to `dist/` directory

### Loading in Chrome
After running `npm run deploy`, load the `dist/` directory as an unpacked extension in Chrome.

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

- `constants.js` - Defines default colors and i18n helper
- `pages-list.js` - Manages list of pages with highlights
- `manifest.json` - Extension configuration with permissions and commands
- `_locales/` - Internationalization files (en, ja, ko, zh)
- `e2e-tests/` - Playwright test files
- `scripts/deploy.js` - Deployment script

### Storage Architecture

- Uses `chrome.storage.local` for highlight data
- Highlights stored by URL as key
- Metadata stored with `${url}_meta` suffix
- Custom colors stored in `customColors` array

### Debug Mode

Debug logging is controlled by `DEBUG_MODE` constants in each file. Set to `true` for development debugging.

### Testing Structure

- Jest for unit tests with jsdom environment
- Playwright for E2E tests in `e2e-tests/` directory
- Mock Chrome APIs in `mocks/chrome.js`
- Test fixtures in `e2e-tests/fixtures.js`