export const STORAGE_KEYS = {
  CUSTOM_COLORS: 'customColors',
  MINIMAP_VISIBLE: 'minimapVisible',
  SELECTION_CONTROLS_VISIBLE: 'selectionControlsVisible',
  ONE_CLICK_HIGHLIGHT: 'oneClickHighlightEnabled',
  LAST_USED_COLOR: 'lastUsedColor',
  SYNC_MIGRATION_DONE: 'syncMigrationDone',
  META_SUFFIX: '_meta',
  SHORTCUT_COLOR_MAP: 'shortcutColorMap',
  HIDE_DEFAULT_COLORS: 'hideDefaultColors',
};

export const SYNC_KEYS = {
  SETTINGS: 'settings',
  HIGHLIGHT_PREFIX: 'hl_',
  META: 'sync_meta',
};

export const CLOUD_SYNC_KEYS = {
  ENABLED: 'cloudSyncEnabled',
  CODE: 'cloudSyncCode',
  LAST_SYNCED_AT: 'cloudSyncLastSyncedAt',
  LAST_ERROR: 'cloudSyncLastError',
  LAST_TRIMMED_COUNT: 'cloudSyncLastTrimmedCount',
  DELETED_URLS: 'cloudSyncDeletedUrls',
  SETTINGS_UPDATED_AT: 'cloudSyncSettingsUpdatedAt',
};

// storage.session: kept across background restarts, cleared when the browser
// or the extension restarts.
export const SESSION_KEYS = {
  CONTEXT_MENU_SIGNATURE: 'contextMenuSignature',
};

// Every storage.local key that is not a page: settings, the cloud sync state,
// and 'settings', which is storage.sync's settings item and never local, but
// costs nothing to rule out.
const NON_PAGE_KEYS = new Set([
  ...Object.values(STORAGE_KEYS).filter(key => key !== STORAGE_KEYS.META_SUFFIX),
  ...Object.values(CLOUD_SYNC_KEYS),
  SYNC_KEYS.SETTINGS,
]);

/**
 * Whether a storage.local entry is a page's highlight list: keyed by the page
 * url, holding an array, and not the page's `_meta` companion.
 *
 * customColors is an array too, which is why the settings keys are ruled out
 * by name rather than by shape. A new array-valued setting has to be added to
 * STORAGE_KEYS, or it is read as a page.
 */
export function isPageKey(key, value) {
  return !NON_PAGE_KEYS.has(key)
    && !key.endsWith(STORAGE_KEYS.META_SUFFIX)
    && Array.isArray(value);
}
