import chrome from '../mocks/chrome.js';
import { initContextMenus } from '../background/context-menu.js';

// Default color values from settings-service (used to verify handler logic)
const DEFAULT_COLORS = {
  yellow: '#FFFF00',
  green:  '#AAFFAA',
  blue:   '#AAAAFF',
  pink:   '#FFAAFF',
  orange: '#FFAA55',
};

describe('context-menu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initContextMenus();
  });

  // ===================================================================
  // Listener registration
  // ===================================================================

  describe('initContextMenus — listener registration', () => {
    it('should register exactly one contextMenus.onClicked listener', () => {
      expect(chrome.contextMenus.onClicked.addListener).toHaveBeenCalledTimes(1);
    });

    it('should register exactly one commands.onCommand listener', () => {
      expect(chrome.commands.onCommand.addListener).toHaveBeenCalledTimes(1);
    });

    it('should register exactly one tabs.onActivated listener for shortcut change detection', () => {
      expect(chrome.tabs.onActivated.addListener).toHaveBeenCalledTimes(1);
    });
  });

  // ===================================================================
  // contextMenus.onClicked handler
  // ===================================================================

  describe('contextMenus.onClicked handler', () => {
    function getClickListener() {
      return chrome.contextMenus.onClicked.addListener.mock.calls[0][0];
    }

    it('should send a highlight message to the tab when a color menu item is clicked', async () => {
      const clickListener = getClickListener();
      await clickListener(
        { menuItemId: 'highlight-yellow', selectionText: 'selected text' },
        { id: 42 },
      );

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, {
        action: 'highlight',
        color: DEFAULT_COLORS.yellow,
        text: 'selected text',
      });
    });

    it('should NOT send a message for the parent "highlight-text" menu item', async () => {
      const clickListener = getClickListener();
      await clickListener({ menuItemId: 'highlight-text', selectionText: 'hello' }, { id: 1 });

      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('should NOT send a message for an unknown menu item id', async () => {
      const clickListener = getClickListener();
      await clickListener({ menuItemId: 'highlight-unknown-color', selectionText: 'hi' }, { id: 1 });

      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ===================================================================
  // commands.onCommand handler
  // ===================================================================

  describe('commands.onCommand handler', () => {
    function getCommandListener() {
      return chrome.commands.onCommand.addListener.mock.calls[0][0];
    }

    it.each([
      ['command_slot_1', DEFAULT_COLORS.yellow],
      ['command_slot_2',  DEFAULT_COLORS.green],
      ['command_slot_3',   DEFAULT_COLORS.blue],
      ['command_slot_4',   DEFAULT_COLORS.pink],
      ['command_slot_5', DEFAULT_COLORS.orange],
    ])('should send highlight with correct color for command "%s"', async (command, expectedColor) => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 99 }]);
      const commandListener = getCommandListener();
      await commandListener(command);

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(99, {
        action: 'highlight',
        color: expectedColor,
      });
    });

    it('should do nothing when no active tab is found', async () => {
      chrome.tabs.query.mockResolvedValueOnce([]);
      const commandListener = getCommandListener();
      await commandListener('command_slot_1');

      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('should do nothing for an unknown command name', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1 }]);
      const commandListener = getCommandListener();
      await commandListener('unknown_command');

      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

  });
});
