import chrome from '../mocks/chrome.js';

// A service worker that a message woke up is still loading the custom colours
// when it handles that message. Whatever the message does to the palette must
// land on top of the loaded list, not be wiped by it a moment later.
//
// Each test gets a fresh copy of settings-service, so "not loaded yet" is the
// module's real starting state rather than a flag reset by hand.
describe('settings-service palette changes on a waking worker', () => {
  const existing = { id: 'custom_1', colorNumber: 1, color: '#111111' };

  function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
  }

  async function freshService() {
    let service;
    await jest.isolateModulesAsync(async () => {
      service = await import('../background/settings-service.js');
    });
    return service;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps a colour added while the initial load is in flight', async () => {
    const service = await freshService();
    // The initial load reads storage.sync first, and that read is slow.
    const syncRead = deferred();
    chrome.storage.sync.get.mockImplementationOnce(() => syncRead.promise);
    // Whatever storage.local is asked for, it holds the one existing colour.
    chrome.storage.local.get.mockImplementation(() => Promise.resolve({ customColors: [existing] }));

    const load = service.loadCustomColors();
    const adding = service.addCustomColor('#222222');

    // The sync read answers with the list from before the add.
    syncRead.resolve({ settings: { customColors: [existing] } });
    const [, result] = await Promise.all([load, adding]);

    const colours = service.getCurrentColors().map(c => c.color);
    expect(result.exists).toBe(false);
    expect(result.colors.map(c => c.color)).toEqual(expect.arrayContaining(['#111111', '#222222']));
    expect(colours).toEqual(expect.arrayContaining(['#111111', '#222222']));
  });

  it('answers the first add on a cold worker with the stored colours as well', async () => {
    const service = await freshService();
    chrome.storage.local.get.mockImplementation(() => Promise.resolve({ customColors: [existing] }));

    const result = await service.addCustomColor('#222222');

    expect(result.colors.map(c => c.color)).toEqual(expect.arrayContaining(['#111111', '#222222']));
  });

  it('removes from the loaded list, not from the defaults a cold worker starts with', async () => {
    const service = await freshService();
    const other = { id: 'custom_2', colorNumber: 2, color: '#222222' };
    chrome.storage.local.get.mockImplementation(() => Promise.resolve({ customColors: [existing, other] }));

    await service.removeCustomColor('custom_2');

    const colours = service.getCurrentColors().map(c => c.color);
    expect(colours).toContain('#111111');
    expect(colours).not.toContain('#222222');
  });

  it('lets settings from sync replace the loaded list rather than race it', async () => {
    const service = await freshService();
    const syncRead = deferred();
    chrome.storage.sync.get.mockImplementationOnce(() => syncRead.promise);
    chrome.storage.local.get.mockImplementation(() => Promise.resolve({ customColors: [existing] }));

    const load = service.loadCustomColors();
    const applying = service.applySettingsFromSync({
      customColors: [{ id: 'custom_9', colorNumber: 9, color: '#999999' }],
    });
    syncRead.resolve({ settings: { customColors: [existing] } });
    await Promise.all([load, applying]);

    const colours = service.getCurrentColors().map(c => c.color);
    expect(colours).toContain('#999999');
    expect(colours).not.toContain('#111111');
  });

  it('still changes the palette when the load itself failed', async () => {
    const service = await freshService();
    chrome.storage.sync.get.mockImplementationOnce(() => Promise.reject(new Error('sync down')));
    chrome.storage.local.get
      .mockImplementationOnce(() => Promise.reject(new Error('local down')))
      .mockImplementation(() => Promise.resolve({ customColors: [existing] }));

    const result = await service.addCustomColor('#222222');

    expect(result.exists).toBe(false);
    expect(service.getCurrentColors().map(c => c.color)).toContain('#222222');
  });
});
