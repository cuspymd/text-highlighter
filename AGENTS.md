# AGENTS.md

This file provides guidance to coding agents when working with this repository.
It covers only what the code does not say for itself - the traps, the reasons,
and the commands. For structure, read the tree.

"Marks: Text Highlighter" is a cross-browser (Chrome + Firefox) text highlighting
extension.

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

## Extension API calls

`shared/browser-api.js` picks the extension namespace (`browser` on Firefox,
`chrome` on Chrome). It is not a polyfill - it returns that object unchanged, so
the two APIs' differences reach the caller. Firefox and Chrome disagree about how
async extension APIs answer, so **always use the promise form and never pass a
callback**:

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

## Testing page scripts

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

## Debug Mode

Release builds force debug off through `scripts/version-deploy.cjs` by rewriting
`shared/logger.js` and `content-scripts/content-common.js`. Keep the debug flag
declarations in those two files in a shape that script can still match.

## Data and Storage

Highlights and metadata live in extension local storage, keyed per page.
`constants/storage-keys.js` is the authority on key shapes - read it rather than
composing keys by hand. Translations live in `_locales/`.

## Skills

Repository skills live in `.agents/skills/`, which is tracked in git. Claude Code
only discovers skills under `.claude/skills/`, so run `npm run link-skills` once
per clone to link `.claude/skills` to it instead of duplicating the files. Add
new skills under `.agents/skills/<name>/SKILL.md` only.
