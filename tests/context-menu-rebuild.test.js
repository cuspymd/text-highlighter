import chrome from '../mocks/chrome.js';

// The background is stopped after ~30s idle and started again by a tab switch
// or a page load. The browser keeps the context menu across that restart, so a
// restart that would build the same menu must leave it alone - and a tab switch
// that woke the background must not rebuild it either.
//
// Each test loads a fresh copy of the background modules, which is what a
// restart does: module state starts over, storage.session and the browser's
// menu do not.

function sessionStorageMock() {
  const data = {};
  return {
    data,
    get: jest.fn(async (key) => (key in data ? { [key]: data[key] } : {})),
    set: jest.fn(async (items) => { Object.assign(data, items); }),
    remove: jest.fn(async (key) => { delete data[key]; }),
  };
}

async function startBackground() {
  let settings;
  let contextMenu;
  await jest.isolateModulesAsync(async () => {
    settings = await import('../background/settings-service.js');
    contextMenu = await import('../background/context-menu.js');
  });
  await settings.initializePlatform();
  return { settings, contextMenu };
}

const custom = { id: 'custom_1', colorNumber: 1, color: '#13579B' };
const shortcuts = [
  { name: 'command_slot_1', shortcut: 'Ctrl+Shift+1' },
  { name: 'command_slot_2', shortcut: 'Ctrl+Shift+2' },
];

function menuIds() {
  return chrome.contextMenus.items.map(item => item.id);
}

describe('context menu rebuilds across background restarts', () => {
  let session;

  beforeEach(() => {
    jest.clearAllMocks();
    chrome.contextMenus.items.length = 0;
    session = sessionStorageMock();
    chrome.storage.session = session;
    chrome.runtime.getPlatformInfo.mockResolvedValue({ os: 'win' });
    chrome.commands.getAll.mockResolvedValue(shortcuts);
    chrome.storage.local.get.mockImplementation(async () => ({ customColors: [custom] }));
  });

  afterEach(() => {
    delete chrome.storage.session;
    chrome.commands.getAll.mockResolvedValue([]);
    chrome.storage.local.get.mockImplementation(async () => ({}));
  });

  async function startAndBuild() {
    const background = await startBackground();
    await background.settings.loadCustomColors();
    await background.settings.createOrUpdateContextMenus();
    return background;
  }

  it('builds the menu on first start and remembers what it built', async () => {
    await startAndBuild();

    expect(chrome.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    expect(menuIds()).toEqual([
      'highlight-text', 'highlight-yellow', 'highlight-green', 'highlight-blue',
      'highlight-pink', 'highlight-orange', 'highlight-custom_1',
    ]);
    expect(session.data.contextMenuSignature).toEqual(expect.any(String));
  });

  it('does not rebuild the same menu twice within one background', async () => {
    const { settings } = await startAndBuild();
    jest.clearAllMocks();

    await settings.createOrUpdateContextMenus();

    expect(chrome.contextMenus.removeAll).not.toHaveBeenCalled();
    expect(chrome.contextMenus.create).not.toHaveBeenCalled();
    expect(session.get).not.toHaveBeenCalled();
  });

  it('leaves the menu alone when a restarted background would build the same one', async () => {
    await startAndBuild();
    jest.clearAllMocks();

    await startAndBuild();

    expect(chrome.contextMenus.removeAll).not.toHaveBeenCalled();
    expect(chrome.contextMenus.create).not.toHaveBeenCalled();
    expect(menuIds()).toContain('highlight-custom_1');
  });

  it('leaves the menu alone when a tab switch wakes the background before startup loaded the colours', async () => {
    await startAndBuild();
    jest.clearAllMocks();

    // Woken by the tab switch: the switch is handled while startup is still
    // reading the colours from storage.
    let finishRead;
    chrome.storage.local.get.mockImplementationOnce(
      () => new Promise((resolve) => { finishRead = () => resolve({ customColors: [custom] }); }),
    );
    const { settings, contextMenu } = await startBackground();
    contextMenu.initContextMenus();
    const onActivated = chrome.tabs.onActivated.addListener.mock.calls[0][0];
    const startup = settings.loadCustomColors().then(() => settings.createOrUpdateContextMenus());
    const switched = onActivated({ tabId: 1 });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    finishRead();
    await Promise.all([startup, switched]);

    expect(chrome.contextMenus.removeAll).not.toHaveBeenCalled();
    expect(chrome.contextMenus.create).not.toHaveBeenCalled();
  });

  it('rebuilds after a restart when a shortcut was changed meanwhile', async () => {
    await startAndBuild();
    jest.clearAllMocks();
    chrome.commands.getAll.mockResolvedValue([
      { name: 'command_slot_1', shortcut: 'Alt+1' },
      { name: 'command_slot_2', shortcut: 'Ctrl+Shift+2' },
    ]);

    const { contextMenu } = await startBackground();
    contextMenu.initContextMenus();
    await chrome.tabs.onActivated.addListener.mock.calls[0][0]({ tabId: 1 });

    expect(chrome.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    expect(chrome.contextMenus.items.find(item => item.id === 'highlight-yellow').title).toContain('Alt+1');
  });

  it('rebuilds when the palette changed, in the same background', async () => {
    const { settings } = await startAndBuild();
    jest.clearAllMocks();

    await settings.applySettingsFromSync({ hideDefaultColors: true });

    expect(chrome.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    expect(menuIds()).toEqual(['highlight-text', 'highlight-custom_1']);
    await settings.applySettingsFromSync({ hideDefaultColors: false });
  });

  it('does not trust a build that was cut short', async () => {
    const first = await startBackground();
    await first.settings.loadCustomColors();
    chrome.contextMenus.removeAll.mockImplementationOnce(() => Promise.reject(new Error('stopped')));
    await first.settings.createOrUpdateContextMenus();
    expect(session.data.contextMenuSignature).toBeUndefined();

    jest.clearAllMocks();
    await startAndBuild();

    expect(chrome.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    expect(menuIds()).toContain('highlight-custom_1');
  });

  it('forgets the last menu before removing it, so a stop halfway cannot be skipped later', async () => {
    await startAndBuild();
    const removeSignature = session.remove.mock.invocationCallOrder[0];
    const removeAll = chrome.contextMenus.removeAll.mock.invocationCallOrder[0];

    expect(removeSignature).toBeLessThan(removeAll);
  });

  it('rebuilds on every restart where the browser has no storage.session', async () => {
    delete chrome.storage.session;
    await startAndBuild();
    jest.clearAllMocks();

    await startAndBuild();

    expect(chrome.contextMenus.removeAll).toHaveBeenCalledTimes(1);
  });
});
