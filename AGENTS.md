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
- `npm run deploy` - Build both Chrome (`dist/`) and Firefox (`dist-firefox/`) extension files
- `npm run deploy:chrome` - Build Chrome extension files into `dist/`
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

`runtime.sendMessage` is a different signature - the callback is its own
parameter there, and both browsers do call it - so the callback form is not the
silent failure `tabs.sendMessage` is. It is still written in the promise form
everywhere, for one shape and one error path: a background that is not listening
rejects, which `await` and `catch` handle the same way on both browsers, rather
than arriving as `lastError` on one and nothing at all on the other.

That rejection has to be caught, and the promise form makes it easy to forget.
The callback form delivered a sleeping service worker as an undefined response,
so a caller's `if (!response || !response.success)` already handled it; `await`
without a catch turns the same case into an unhandled rejection, and the click
that triggered it silently does nothing. `sendToBackground(message)` from
`shared/runtime-message.js` awaits and returns `null` there, which lands on that
same branch. Page scripts should use it.

Both mocks in `mocks/chrome.js` throw when a callback is passed, so either form
fails the unit suite by name. `tests/runtime-message-guard.test.js` and the
guard block in `tests/tab-broadcast.test.js` cover the guards themselves.

`storage.local.get` in `content.js` is the one callback left. It answers on both
browsers, and the harness stubs serve both shapes, but it is the odd one out.

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

## Content script structure

Logic that needs no extension API lives in its own file, wrapped in an IIFE that
publishes a namespace on `window`: `content-core.js` (text anchoring),
`restore-core.js` (which group claims which region, and whether a restore is
still coming), `color-core.js` (the picker's colour maths). `content.js` and
`controls.js` keep same-named wrappers that delegate, so call sites read as
before.

The point is testability. Those files are importable, so a test calls them
directly and the coverage instrumenter sees them - the evaluated scripts report
0% whether or not a test drove them. Put new pure logic there rather than in
`content.js`, and add the file to `content_scripts.js` in **both** manifests,
before the scripts that read it. The build copies the whole directory, so
nothing else needs changing.

## Testing content scripts

The scripts themselves are not importable: the manifest injects them in order
and they find each other through `window`. `tests/helpers/content-script.js`
loads them the way the manifest does. Use it rather than evaluating sources by
hand - the point is that every test goes through `mocks/chrome.js`, so a guard
added there reaches all of them.

- `loadContentScripts(['common', 'content'])` evaluates those two in manifest
  order and stubs what the ones it skipped would have published. That list of
  neighbour globals lives in the helper, so adding a function to `controls.js`
  does not break four test files at once.
- `respondToBackground(handler)` answers messages; returning a never-settling
  promise stands for a background that is still waking up, and throwing stands
  for one that is not there at all.
- `respondToStorage(values)` answers `storage.local.get` in both shapes, since
  that call is still a callback.
- The returned object exposes `sendToContentScript(message)` for the messages
  the background and popup send in.
- Loading is async now: the colours round trip is a promise, so a test has to
  let it settle before advancing timers. `jest.advanceTimersByTimeAsync` does
  both; the synchronous form does not.

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
