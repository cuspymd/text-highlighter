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

- `shared/browser-api.js`: picks the extension namespace (`browser` on Firefox, `chrome` on Chrome). Not a polyfill - it returns that object unchanged, so the two APIs' differences reach the caller. See "Extension API calls" below.
- `shared/logger.js`: debug logging switch and logger helpers
- `shared/modal.js`, `shared/modal.css`, `shared/localized-modal.js`: reusable modal system
- `shared/import-export-schema.js`: import/export data schema utilities

### Constants

- `constants/storage-keys.js`: storage key definitions shared across modules

### Testing page scripts

`popup.js`, `pages-list.js` and `settings.js` are not importable modules: each
one is a single `DOMContentLoaded` closure with no exports. `tests/helpers/extension-page.js`
drives them the way the browser does - it puts the page's own `<body>` into jsdom,
loads the script, and hands back its handler to await. See `tests/popup.test.js`.

Two things it takes care of, both of which fail confusingly otherwise:

- The handler is captured rather than dispatched. It is `async`, so
  `dispatchEvent` returns before the page has loaded anything.
- Waiting is done with `advance()` (`jest.advanceTimersByTimeAsync`). The popup's
  restore poll alternates timers with awaited round trips, so the synchronous
  `advanceTimersByTime` leaves the continuation unrun.

## Browser and Manifest Notes

- Chrome manifest: `manifest.json`
- Firefox manifest: `manifest-firefox.json`
- Firefox-specific settings (gecko id/min versions) are defined in `manifest-firefox.json`

### Extension API calls

`browserAPI` is the raw `browser`/`chrome` object, not a polyfill. Firefox and
Chrome disagree about how async extension APIs answer, so **always use the
promise form and never pass a callback**:

```js
// Do this - works on both
try {
  const response = await browserAPI.tabs.sendMessage(tabId, message);
} catch (error) {
  // nothing listening on that tab
}

// Not this - the callback never runs on Firefox
browserAPI.tabs.sendMessage(tabId, message, (response) => { ... });
```

On Firefox the third argument is an options object, so a callback passed there
is simply never called - the code goes silently dead rather than failing loudly.
Chrome MV3 returns a promise too, so the promise form costs nothing there.

For the same reason, `browserAPI.runtime.lastError` is Chrome-only bookkeeping:
with promises, a missing receiver arrives as a rejection. Catch it instead.

This is easy to get wrong because the E2E suite runs on Chromium only, where the
callback form still works - a Chrome-green test run says nothing about Firefox.

So tab messages do not go through `browserAPI` directly. Send them with
`sendMessageToTab(tabId, message)` from `shared/tab-broadcast.js`, which awaits
the promise and returns `null` when nothing is listening. It is the only place
in the extension that calls `tabs.sendMessage`, which leaves no call site with a
third argument to get wrong. `broadcastToAllTabs` / `broadcastToTabsByUrl` in the
same module cover the many-tab cases.

The `tabs.sendMessage` mock in `mocks/chrome.js` throws when a callback is
passed, so the form that goes dead on Firefox fails the unit suite by name
instead of going quiet the way the browser does.

Note that `runtime.sendMessage` in the content scripts and `pages-list.js` is
still callback-style and has not been verified against a Firefox build.

## Localization

Localization files are in `_locales/`.
Current locales: `en`, `es`, `ja`, `ko`, `zh`, `pt`.

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
- `scripts/link-skills.cjs`: links `.claude/skills` to `.agents/skills` for Claude Code

## Skills

Repository skills live in `.agents/skills/`, which is tracked in git. Claude Code only discovers skills under `.claude/skills/`, so run `npm run link-skills` once per clone to link `.claude/skills` to it instead of duplicating the files. Add new skills under `.agents/skills/<name>/SKILL.md` only.

Reusable release workflow skill:
- `.agents/skills/version-release/SKILL.md`
