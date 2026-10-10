import chrome from '../mocks/chrome.js';
import {
  initializePlatform,
  isMobile,
  getPlatformInfo,
  getCurrentColors,
  createOrUpdateContextMenus,
  addCustomColor,
  clearCustomColors,
  applySettingsFromSync,
  broadcastSettingsToTabs,
  loadCustomColors,
  getShortcutColorMap,
  getVisibleColors,
  setHideDefaultColors,
} from '../background/settings-service.js';
import { initContextMenus } from '../background/context-menu.js';

describe('settings-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===================================================================
  // Platform detection
  // ===================================================================

  describe('initializePlatform / isMobile', () => {
    it('should return true if platform is android', async () => {
      chrome.runtime.getPlatformInfo.mockResolvedValue({ os: 'android' });
      await initializePlatform();
      expect(isMobile()).toBe(true);
    });

    it('should return false if platform is mac', async () => {
      chrome.runtime.getPlatformInfo.mockResolvedValue({ os: 'mac' });
      await initializePlatform();
      expect(isMobile()).toBe(false);
    });

    it('should return false if platform is win', async () => {
      chrome.runtime.getPlatformInfo.mockResolvedValue({ os: 'win' });
      await initializePlatform();
      expect(isMobile()).toBe(false);
    });

    it('should return false if platform is linux', async () => {
      chrome.runtime.getPlatformInfo.mockResolvedValue({ os: 'linux' });
      await initializePlatform();
      expect(isMobile()).toBe(false);
    });
  });

  describe('getPlatformInfo', () => {
    it('should return both platform object and isMobile flag', async () => {
      chrome.runtime.getPlatformInfo.mockResolvedValue({ os: 'mac' });
      await initializePlatform();

      const info = await getPlatformInfo();
      expect(info).toHaveProperty('platform');
      expect(info).toHaveProperty('isMobile', false);
      expect(info.platform.os).toBe('mac');
    });
  });

  // ===================================================================
  // Color state
  // ===================================================================

  describe('getCurrentColors', () => {
    it('should include all 5 built-in default colors', () => {
      const colors = getCurrentColors();
      const ids = colors.map(c => c.id);
      expect(ids).toContain('yellow');
      expect(ids).toContain('green');
      expect(ids).toContain('blue');
      expect(ids).toContain('pink');
      expect(ids).toContain('orange');
    });

    it('each default color should have id, nameKey, and color properties', () => {
      const defaults = getCurrentColors().filter(c => !c.id.startsWith('custom_'));
      for (const c of defaults) {
        expect(c).toHaveProperty('id');
        expect(c).toHaveProperty('nameKey');
        expect(c).toHaveProperty('color');
      }
    });
  });

  // ===================================================================
  // Context menus
  // ===================================================================

  describe('createOrUpdateContextMenus', () => {
    it('should remove all menus then recreate them on desktop', async () => {
      chrome.runtime.getPlatformInfo.mockResolvedValue({ os: 'mac' });
      await initializePlatform();
      await createOrUpdateContextMenus();

      expect(chrome.contextMenus.removeAll).toHaveBeenCalled();
      expect(chrome.contextMenus.create).toHaveBeenCalled();
    });

    it('should skip menu creation entirely on mobile (android)', async () => {
      chrome.runtime.getPlatformInfo.mockResolvedValue({ os: 'android' });
      await initializePlatform();
      jest.clearAllMocks(); // reset counts after initializePlatform
      await createOrUpdateContextMenus();

      expect(chrome.contextMenus.removeAll).not.toHaveBeenCalled();
    });
  });

  // ===================================================================
  // Custom color management
  // ===================================================================

  describe('addCustomColor', () => {
    it('should add a new color and return exists: false', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({ customColors: [] });
      const result = await addCustomColor('#AABB01');

      expect(result.exists).toBe(false);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ customColors: expect.any(Array) }),
      );
    });

    it('should store new custom colors without nameKey', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({ customColors: [] });
      await addCustomColor('#AABB02');

      const latestCustomColorsSetCall = chrome.storage.local.set.mock.calls
        .map(([arg]) => arg)
        .filter(arg => Array.isArray(arg.customColors))
        .pop();
      const addedColor = latestCustomColorsSetCall.customColors.find(c => c.color === '#AABB02');

      expect(addedColor).toBeTruthy();
      expect(addedColor).not.toHaveProperty('nameKey');
    });

    it('should return exists: true for a built-in default color (case-insensitive)', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({ customColors: [] });
      const result = await addCustomColor('#ffff00'); // yellow, lowercase

      expect(result.exists).toBe(true);
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('should return exists: true when color value is null', async () => {
      const result = await addCustomColor(null);
      expect(result.exists).toBe(true);
    });

    it('should assign next number after max existing custom color number', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({ customColors: [] });
      await clearCustomColors();

      chrome.storage.local.get.mockResolvedValueOnce({
        customColors: [
          { id: 'custom_a', color: '#111111', colorNumber: 1 },
          { id: 'custom_b', color: '#222222', colorNumber: 4 },
          { id: 'custom_c', color: '#333333', colorNumber: 3 },
        ],
      });

      await addCustomColor('#ABCDEF');

      const latestCustomColorsSetCall = chrome.storage.local.set.mock.calls
        .map(([arg]) => arg)
        .filter(arg => Array.isArray(arg.customColors))
        .pop();
      const addedColor = latestCustomColorsSetCall.customColors.find(c => c.color === '#ABCDEF');

      expect(addedColor).toBeTruthy();
      expect(addedColor.colorNumber).toBe(5);
    });
  });

  describe('clearCustomColors', () => {
    it('should return hadColors: false when there are no stored custom colors', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({ customColors: [] });
      const result = await clearCustomColors();
      expect(result.hadColors).toBe(false);
    });

    it('should clear stored custom colors and return hadColors: true', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({
        customColors: [{ id: 'custom_1', color: '#112233' }],
      });
      const result = await clearCustomColors();

      expect(result.hadColors).toBe(true);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ customColors: [] });
    });
  });

  // ===================================================================
  // Sync settings application
  // ===================================================================

  describe('applySettingsFromSync', () => {
    it('should update custom colors from sync and return colorsChanged: true', async () => {
      const result = await applySettingsFromSync({
        customColors: [{ id: 'custom_sync', color: '#FFAA11' }],
      });

      expect(result.colorsChanged).toBe(true);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ customColors: expect.any(Array) }),
      );
    });

    // Another device's reorder arrives as the array in its new order; the
    // palette has to follow it rather than keep this device's order.
    it('should take the custom color order from sync', async () => {
      const a = { id: 'custom_a', colorNumber: 1, color: '#A10000' };
      const b = { id: 'custom_b', colorNumber: 2, color: '#00B200' };
      const c = { id: 'custom_c', colorNumber: 3, color: '#0000C3' };

      await applySettingsFromSync({ customColors: [a, b, c] });
      await applySettingsFromSync({ customColors: [c, a, b] });

      const customIds = getCurrentColors().filter(color => color.id.startsWith('custom_')).map(color => color.id);
      expect(customIds).toEqual(['custom_c', 'custom_a', 'custom_b']);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ customColors: [c, a, b] }),
      );
    });

    it('should persist minimapVisible locally and return colorsChanged: false', async () => {
      const result = await applySettingsFromSync({ minimapVisible: false });

      expect(result.colorsChanged).toBe(false);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ minimapVisible: false });
    });

    it('should persist selectionControlsVisible locally and return colorsChanged: false', async () => {
      const result = await applySettingsFromSync({ selectionControlsVisible: false });

      expect(result.colorsChanged).toBe(false);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ selectionControlsVisible: false });
    });

    it('should persist oneClickHighlightEnabled locally and return colorsChanged: false', async () => {
      const result = await applySettingsFromSync({ oneClickHighlightEnabled: true });

      expect(result.colorsChanged).toBe(false);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ oneClickHighlightEnabled: true });
    });

    it('should return colorsChanged: false when settings contain no color data', async () => {
      const result = await applySettingsFromSync({});
      expect(result.colorsChanged).toBe(false);
    });

    it('should adopt a shortcutColorMap from sync', async () => {
      await applySettingsFromSync({ shortcutColorMap: { command_slot_1: 'custom_1' } });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        shortcutColorMap: { command_slot_1: 'custom_1' },
      });
      expect(getShortcutColorMap()).toEqual({ command_slot_1: 'custom_1' });
    });

    // A null map means "no custom mapping" and must be adopted like any other value.
    // Skipping it left two devices claiming the same settings timestamp while disagreeing
    // on content, which made every sync cycle push a blob at the other device forever.
    it('should adopt a null shortcutColorMap instead of keeping the local one', async () => {
      await applySettingsFromSync({ shortcutColorMap: { command_slot_1: 'custom_1' } });
      chrome.storage.local.set.mockClear();

      await applySettingsFromSync({ shortcutColorMap: null });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({ shortcutColorMap: null });
    });

    it('should keep the in-memory shortcut map usable after adopting null', async () => {
      await applySettingsFromSync({ shortcutColorMap: null });

      const map = getShortcutColorMap();
      expect(map).not.toBeNull();
      expect(() => Object.keys(map)).not.toThrow();
    });

    it('should leave the shortcut map untouched when the field is absent', async () => {
      await applySettingsFromSync({ shortcutColorMap: { command_slot_2: 'custom_2' } });
      chrome.storage.local.set.mockClear();

      await applySettingsFromSync({ minimapVisible: true });

      expect(chrome.storage.local.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ shortcutColorMap: expect.anything() }),
      );
      expect(getShortcutColorMap()).toEqual({ command_slot_2: 'custom_2' });
    });
  });

  describe('loadCustomColors', () => {
    it('should sanitize legacy custom colors without writing full settings back to sync', async () => {
      chrome.storage.sync.get.mockResolvedValueOnce({
        settings: {
          customColors: [
            { id: 'custom_legacy', nameKey: 'customColor', color: '#123456' },
          ],
        },
      });
      chrome.storage.local.get.mockResolvedValueOnce({});

      // Every palette change above already loaded this module's colours, so
      // the load has to be watched on a fresh copy.
      await jest.isolateModulesAsync(async () => {
        const fresh = await import('../background/settings-service.js');
        await fresh.loadCustomColors();
      });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        customColors: [
          { id: 'custom_legacy', color: '#123456', colorNumber: 1 },
        ],
      });
      expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    });
  });

  // ===================================================================
  // Tab broadcast
  // ===================================================================

  describe('broadcastSettingsToTabs', () => {
    it('should send setMinimapVisibility to every tab', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
      await broadcastSettingsToTabs({ minimapVisible: true });

      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        expect.any(Number),
        { action: 'setMinimapVisibility', visible: true },
      );
    });

    it('should send setSelectionControlsVisibility to every tab', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 3 }]);
      await broadcastSettingsToTabs({ selectionControlsVisible: false });

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        3,
        { action: 'setSelectionControlsVisibility', visible: false },
      );
    });

    it('should send setOneClickHighlight to every tab', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 4 }]);
      await broadcastSettingsToTabs({ oneClickHighlightEnabled: true });

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        4,
        { action: 'setOneClickHighlight', enabled: true },
      );
    });

    it('should not query tabs when changedSettings is empty', async () => {
      await broadcastSettingsToTabs({});
      expect(chrome.tabs.query).not.toHaveBeenCalled();
    });

    it('should not query tabs when changedSettings is null', async () => {
      await broadcastSettingsToTabs(null);
      expect(chrome.tabs.query).not.toHaveBeenCalled();
    });

    it('should send setHideDefaultColors to every tab', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 5 }]);
      await broadcastSettingsToTabs({ hideDefaultColors: true });

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        5,
        { action: 'setHideDefaultColors', hidden: true },
      );
    });
  });

  // ===================================================================
  // Hiding the default colours
  // ===================================================================

  // The setting narrows what is offered to pick from - the context menu here -
  // and nothing else. The defaults stay in the palette for shortcuts and
  // existing highlights, and stay on offer while there is no custom colour.
  describe('hide default colors', () => {
    const custom = { id: 'custom_hide', colorNumber: 1, color: '#13579B' };

    function createdMenuIds() {
      return chrome.contextMenus.create.mock.calls.map(([item]) => item.id);
    }

    beforeEach(async () => {
      chrome.runtime.getPlatformInfo.mockResolvedValue({ os: 'win' });
      await initializePlatform();
      await applySettingsFromSync({ customColors: [custom] });
      setHideDefaultColors(true);
      jest.clearAllMocks();
    });

    afterAll(() => {
      setHideDefaultColors(false);
    });

    it('offers only the custom colours while keeping the full palette', () => {
      expect(getVisibleColors().map(c => c.id)).toEqual(['custom_hide']);
      expect(getCurrentColors().map(c => c.id)).toEqual(
        ['yellow', 'green', 'blue', 'pink', 'orange', 'custom_hide'],
      );
    });

    it('keeps offering the defaults while there is no custom colour', async () => {
      await applySettingsFromSync({ customColors: [] });

      expect(getVisibleColors().map(c => c.id)).toEqual(['yellow', 'green', 'blue', 'pink', 'orange']);
    });

    it('lists only the visible colours in the context menu', async () => {
      await createOrUpdateContextMenus();

      expect(createdMenuIds()).toEqual(['highlight-text', 'highlight-custom_hide']);
    });

    it('still paints with a default colour from its shortcut slot', async () => {
      // Earlier tests leave a custom mapping behind; null is "the defaults".
      await applySettingsFromSync({ shortcutColorMap: null });
      initContextMenus();
      const onCommand = chrome.commands.onCommand.addListener.mock.calls[0][0];
      chrome.tabs.query.mockResolvedValueOnce([{ id: 9 }]);

      await onCommand('command_slot_1');

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(9, { action: 'highlight', color: '#FFFF00' });
    });

    it('adopts the setting from sync, tells the tabs, and asks for the menus to be rebuilt', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 3 }]);
      const result = await applySettingsFromSync({ hideDefaultColors: false });

      expect(result.colorsChanged).toBe(true);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ hideDefaultColors: false });
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        3,
        { action: 'setHideDefaultColors', hidden: false },
      );
      expect(getVisibleColors()).toHaveLength(6);
    });
  });
});
