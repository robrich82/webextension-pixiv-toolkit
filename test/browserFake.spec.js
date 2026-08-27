const browser = require('./doubles/browser').default;

describe('promise and callback styles', () => {
  test('resolves with the result', async () => {
    await browser.storage.local.set({ a: 1 });

    expect(await browser.storage.local.get('a')).toEqual({ a: 1 });
  });

  test('calls a trailing callback with the same result', done => {
    browser.storage.local.set({ a: 1 }, () => {
      browser.storage.local.get('a', items => {
        expect(items).toEqual({ a: 1 });
        done();
      });
    });
  });

  test('records the call for assertions', async () => {
    await browser.storage.local.set({ a: 1 });

    expect(browser.storage.local.set).toHaveBeenCalledWith({ a: 1 });
  });
});

describe('storage.local', () => {
  beforeEach(async () => {
    await browser.storage.local.set({ a: 1, b: 2 });
  });

  test('reads everything for a null key', async () => {
    expect(await browser.storage.local.get(null)).toEqual({ a: 1, b: 2 });
  });

  test('reads a list of keys, skipping the ones not stored', async () => {
    expect(await browser.storage.local.get(['a', 'nope'])).toEqual({ a: 1 });
  });

  test('falls back to the defaults given as an object', async () => {
    expect(await browser.storage.local.get({ a: 'x', nope: 'default' }))
      .toEqual({ a: 1, nope: 'default' });
  });

  test('removes a key', async () => {
    await browser.storage.local.remove('a');

    expect(await browser.storage.local.get(null)).toEqual({ b: 2 });
  });

  test('stores a copy, so a later mutation of the argument does not leak in', async () => {
    const value = { nested: 'before' };

    await browser.storage.local.set({ value });
    value.nested = 'after';

    expect(await browser.storage.local.get('value')).toEqual({ value: { nested: 'before' } });
  });
});

describe('storage.onChanged', () => {
  test('fires with the old and new values of a written key', async () => {
    const listener = jest.fn();

    browser.storage.onChanged.addListener(listener);
    await browser.storage.local.set({ a: 1 });
    await browser.storage.local.set({ a: 2 });

    expect(listener).toHaveBeenLastCalledWith({ a: { oldValue: 1, newValue: 2 } }, 'local');
  });

  test('omits the old value for a key that was not stored yet', async () => {
    const listener = jest.fn();

    browser.storage.onChanged.addListener(listener);
    await browser.storage.local.set({ a: 1 });

    expect(listener).toHaveBeenCalledWith({ a: { newValue: 1 } }, 'local');
  });

  test('fires on a remove, with only the old value', async () => {
    await browser.storage.local.set({ a: 1 });

    const listener = jest.fn();

    browser.storage.onChanged.addListener(listener);
    await browser.storage.local.remove('a');

    expect(listener).toHaveBeenCalledWith({ a: { oldValue: 1 } }, 'local');
  });

  test('stays quiet when a remove matches nothing', async () => {
    const listener = jest.fn();

    browser.storage.onChanged.addListener(listener);
    await browser.storage.local.remove('nope');

    expect(listener).not.toHaveBeenCalled();
  });

  test('does not fire for a removed listener', async () => {
    const listener = jest.fn();

    browser.storage.onChanged.addListener(listener);
    browser.storage.onChanged.removeListener(listener);
    await browser.storage.local.set({ a: 1 });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('runtime.sendMessage', () => {
  test('resolves with what the listener passes to sendResponse', async () => {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      sendResponse({ echoed: message });

      return true;
    });

    expect(await browser.runtime.sendMessage({ action: 'ping' }))
      .toEqual({ echoed: { action: 'ping' } });
  });

  test('resolves after a listener that responds asynchronously', async () => {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      Promise.resolve().then(() => sendResponse('late'));

      return true;
    });

    expect(await browser.runtime.sendMessage({ action: 'ping' })).toBe('late');
  });

  test('resolves undefined when nothing is listening', async () => {
    expect(await browser.runtime.sendMessage({ action: 'ping' })).toBeUndefined();
  });

  test('passes the sender to the listener', async () => {
    const listener = jest.fn();

    browser.runtime.onMessage.addListener(listener);
    await browser.runtime.sendMessage({ action: 'ping' });

    expect(listener).toHaveBeenCalledWith(
      { action: 'ping' },
      { id: browser.runtime.id },
      expect.any(Function)
    );
  });
});

describe('runtime.connect', () => {
  test('reaches onConnect with a port of the same name', async () => {
    const onConnect = jest.fn();

    browser.runtime.onConnect.addListener(onConnect);
    browser.runtime.connect({ name: 'download-record-port' });
    await browser._fake.flush();

    expect(onConnect.mock.calls[0][0].name).toBe('download-record-port');
  });

  test('does not dispatch before the caller can attach its listeners', async () => {
    const onConnect = jest.fn();

    browser.runtime.onConnect.addListener(onConnect);
    browser.runtime.connect({ name: 'a-port' });

    expect(onConnect).not.toHaveBeenCalled();
  });

  test('delivers a message posted from one end to the other', async () => {
    const received = jest.fn();

    browser.runtime.onConnect.addListener(port => port.onMessage.addListener(received));

    const client = browser.runtime.connect({ name: 'a-port' });

    await browser._fake.flush();
    client.postMessage({ action: 'hello' });

    expect(received).toHaveBeenCalledWith({ action: 'hello' }, client.peer);
  });

  test('delivers a reply back to the caller', async () => {
    const received = jest.fn();

    browser.runtime.onConnect.addListener(port => port.postMessage({ action: 'ready' }));

    const client = browser.runtime.connect({ name: 'a-port' });

    client.onMessage.addListener(received);
    await browser._fake.flush();

    expect(received).toHaveBeenCalledWith({ action: 'ready' }, client);
  });

  test('notifies the other end of a disconnect', async () => {
    const onDisconnect = jest.fn();

    browser.runtime.onConnect.addListener(port => port.onDisconnect.addListener(onDisconnect));

    const client = browser.runtime.connect({ name: 'a-port' });

    await browser._fake.flush();
    client.disconnect();

    expect(onDisconnect).toHaveBeenCalled();
  });

  test('refuses to post on a disconnected port', async () => {
    const client = browser.runtime.connect({ name: 'a-port' });

    client.disconnect();

    expect(() => client.postMessage({})).toThrow('disconnected port');
  });
});

describe('downloads', () => {
  test('records the requested filename', async () => {
    await browser.downloads.download({ url: 'https://example.test/a.png', filename: 'a.png' });

    expect(browser._fake.lastDownload()).toMatchObject({ filename: 'a.png' });
  });

  test('hands back a fresh download id each time', async () => {
    const first = await browser.downloads.download({ url: 'https://example.test/a.png' });
    const second = await browser.downloads.download({ url: 'https://example.test/b.png' });

    expect(second).not.toBe(first);
  });

  test('drives onDeterminingFilename and returns the suggestion', () => {
    browser.downloads.onDeterminingFilename.addListener((item, suggest) => {
      suggest({ filename: `renamed/${item.filename}`, conflictAction: 'uniquify' });
    });

    expect(browser._fake.determineFilename({ id: 1, filename: 'a.png' }))
      .toEqual({ filename: 'renamed/a.png', conflictAction: 'uniquify' });
  });
});

describe('tabs', () => {
  test('creates a tab with an id and returns it', async () => {
    const tab = await browser.tabs.create({ url: 'https://example.test/' });

    expect(tab.id).toEqual(expect.any(Number));
    expect(tab.url).toBe('https://example.test/');
  });

  test('gets a tab back by id', async () => {
    const created = await browser.tabs.create({ url: 'https://example.test/' });

    expect(await browser.tabs.get(created.id)).toMatchObject({ id: created.id });
  });

  test('rejects for an unknown tab id, as the browser does', async () => {
    await expect(browser.tabs.get(404)).rejects.toThrow('No tab with id: 404.');
  });

  test('queries on plain properties', async () => {
    await browser.tabs.create({ url: 'https://example.test/a', active: false });
    await browser.tabs.create({ url: 'https://example.test/b', active: true });

    const found = await browser.tabs.query({ active: true });

    expect(found.map(tab => tab.url)).toEqual(['https://example.test/b']);
  });

  test('applies an update to the stored tab', async () => {
    const created = await browser.tabs.create({ url: 'https://example.test/' });

    await browser.tabs.update(created.id, { active: false });

    expect(await browser.tabs.get(created.id)).toMatchObject({ active: false });
  });
});

describe('i18n', () => {
  test('reports the UI language set for the test', () => {
    browser._fake.setUILanguage('ja');

    expect(browser.i18n.getUILanguage()).toBe('ja');
  });

  test('is reachable through the chrome global too', () => {
    browser._fake.setUILanguage('zh-CN');

    expect(chrome.i18n.getUILanguage()).toBe('zh-CN');
  });
});

describe('reset between tests', () => {
  test('leaves nothing behind', async () => {
    expect(await browser.storage.local.get(null)).toEqual({});
    expect(browser.downloads.items.size).toBe(0);
    expect(browser.tabs.items.size).toBe(0);
    expect(browser.storage.onChanged.hasListeners()).toBe(false);
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });
});
