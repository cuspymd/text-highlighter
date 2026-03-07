# Message Routing Matrix

Source of truth: `background/message-router.js`

| action | request fields | response fields | side effects | handler |
|---|---|---|---|---|
| `getDebugMode` | none | `debugMode` | none | `handleGetDebugMode` |
| `getPlatformInfo` | none | `platform`, `isMobile` | none | `handleGetPlatformInfo` |
| `getColors` | none | `colors` | none | `handleGetColors` |
| `saveSettings` | `minimapVisible?`, `selectionControlsVisible?` | `success`, `error?` | local storage write, settings broadcast, sync save | `handleSaveSettings` |
| `getHighlights` | `url` | `highlights` | local storage read | `handleGetHighlights` |
| `clearCustomColors` | none | `success`, `noCustomColors?`, `error?` | local storage write, context menu update, tab broadcast | `handleClearCustomColors` |
| `addColor` | `color` | `success`, `colors?`, `error?` | local storage write, context menu update, tab broadcast | `handleAddColor` |
| `updateCustomColor` | `id`, `color` | `success`, `colors?`, `exists?`, `error?` | local storage write, context menu update, tab broadcast | `handleUpdateCustomColor` |
| `removeCustomColor` | `id` | `success`, `colors?`, `error?` | local storage write, context menu update, tab broadcast | `handleRemoveCustomColor` |
| `getShortcutColorMap` | none | `success`, `shortcutColorMap`, `error?` | local storage read | `handleGetShortcutColorMap` |
| `saveShortcutColorMap` | `shortcutColorMap` | `success`, `error?` | local storage write, context menu update | `handleSaveShortcutColorMap` |
| `saveHighlights` | `url`, `highlights` | `success`, `error?` | local storage write/remove, sync write/remove | `handleSaveHighlights` |
| `deleteHighlight` | `url`, `groupId`, `notifyRefresh?` | `success`, `highlights?`, `error?` | local storage write/remove, sync write/remove, tab broadcast (optional) | `handleDeleteHighlight` |
| `clearAllHighlights` | `url`, `notifyRefresh?` | `success`, `error?` | local storage remove, sync remove, tab broadcast (optional) | `handleClearAllHighlights` |
| `getAllHighlightedPages` | none | `success`, `pages`, `error?` | local storage read | `handleGetAllHighlightedPages` |
| `deleteAllHighlightedPages` | none | `success`, `deletedCount`, `error?` | local storage remove, sync clear | `handleDeleteAllHighlightedPages` |

## Notes
- Unknown actions return `{ success: false, error }`.
- All handlers respond asynchronously through `runtime.onMessage`.
