# AGENTS.md

This file provides guidance to coding agents when working with this repository.

## Project Overview

This is a cross-browser extension called "Marks: Text Highlighter". It supports multi-color text highlighting, highlight management, minimap navigation, keyboard shortcuts, and multilingual UI.

## Essential Commands

### Testing
- `npm test` - Run Jest unit/integration tests (`tests/`)
- `npx playwright test` - Run Playwright E2E tests (`e2e-tests/`)

### Development Builds
- `npm run deploy` - Build Chrome extension files into `dist/`
- `npm run deploy:firefox` - Build Firefox extension files into `dist-firefox/`

### Version Release Builds
- `npm run version-deploy -- <version> chrome` - Bump `manifest.json`, set debug flags for release, build Chrome package, zip to `outputs/`
- `npm run version-deploy -- <version> firefox` - Bump `manifest-firefox.json`, set debug flags for release, build Firefox package, zip to `outputs/`

## Loading Extensions

- Chrome: load unpacked extension from `dist/` via `chrome://extensions`
- Firefox: load temporary add-on from `dist-firefox/manifest.json` via `about:debugging`

## Architecture

### Entry Points

- `background.js`: extension background entry point
- `content-scripts/content.js`: content entry point loaded on all pages
- `popup.js` + `popup.html`: popup UI
- `pages-list.js` + `pages-list.html`: page-level highlight list UI

### Background Modules

- `background/context-menu.js`: context menu behavior
- `background/message-router.js`: runtime message routing
- `background/settings-service.js`: extension settings management
- `background/sync-service.js`: synchronization and conflict handling

### Content Modules

- `content-scripts/content-common.js`: shared content-side APIs/utilities
- `content-scripts/content-core.js`: highlight core logic
- `content-scripts/controls.js`: in-page highlight controls
- `content-scripts/minimap.js`: minimap UI and interactions

### Shared Modules

- `shared/browser-api.js`: browser compatibility wrapper (`browser`/`chrome`)
- `shared/logger.js`: debug logging switch and logger helpers
- `shared/modal.js`, `shared/modal.css`, `shared/localized-modal.js`: reusable modal system
- `shared/import-export-schema.js`: import/export data schema utilities

### Constants

- `constants/storage-keys.js`: storage key definitions shared across modules

## Browser and Manifest Notes

- Chrome manifest: `manifest.json`
- Firefox manifest: `manifest-firefox.json`
- Firefox-specific settings (gecko id/min versions) are defined in `manifest-firefox.json`

## Localization

Localization files are in `_locales/`.
Current locales: `en`, `es`, `ja`, `ko`, `zh`.

## Data and Storage

- Highlights and metadata are stored in extension local storage.
- Page metadata uses `${url}_meta` keys.
- Custom colors are stored separately from highlight groups.
- Sync/tombstone handling is implemented in background sync modules.

## Debug Mode

Release builds force debug off through `scripts/version-deploy.cjs` by updating:
- `shared/logger.js`
- `content-scripts/content-common.js`

## Scripts

- `scripts/deploy.cjs`: copies production files into browser-specific dist directories
- `scripts/version-deploy.cjs`: version bump + release build + zip packaging

## Skills

Reusable release workflow skill:
- `skills/version-release/SKILL.md`
