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
} from '../background/settings-service.js';

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

      const info = getPlatformInfo();
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
  });

  describe('clearCustomColors', () => {
    it('should return hadColors: false when there are no stored custom colors', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({ customColors: [] });
      const result = await clearCustomColors();
      expect(result.hadColors).toBe(false);
    });

    it('should clear stored custom colors and return hadColors: true', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({
        customColors: [{ id: 'custom_1', color: '#112233', nameKey: 'customColor' }],
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
        customColors: [{ id: 'custom_sync', color: '#FFAA11', nameKey: 'customColor' }],
      });

      expect(result.colorsChanged).toBe(true);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ customColors: expect.any(Array) }),
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

    it('should return colorsChanged: false when settings contain no color data', async () => {
      const result = await applySettingsFromSync({});
      expect(result.colorsChanged).toBe(false);
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

    it('should not query tabs when changedSettings is empty', async () => {
      await broadcastSettingsToTabs({});
      expect(chrome.tabs.query).not.toHaveBeenCalled();
    });

    it('should not query tabs when changedSettings is null', async () => {
      await broadcastSettingsToTabs(null);
      expect(chrome.tabs.query).not.toHaveBeenCalled();
    });
  });
});
