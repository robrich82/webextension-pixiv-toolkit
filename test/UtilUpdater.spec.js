/**
 * `Util/Updater` decides whether a stored settings object predates a given
 * version, and reconciles it against the defaults: fill in what is missing,
 * keep what the user set, drop what the defaults no longer have.
 *
 * Note this is not `background/modules/Updater`, which drives the migrations in
 * `test/updates.spec.js`. This one is the settings reconciler the options page
 * uses; the two share a name and nothing else.
 */
const browser = require('./doubles/browser').default;
const Updater = require('../src/modules/Util/Updater').default;

describe('isNewer', () => {
  test('treats settings with no version at all as older than anything', () => {
    // A fresh install has never written a version, and must still take every
    // migration below it.
    expect(new Updater({}, {}).isNewer('6.0.0')).toBe(true);
  });

  test('reports a version above the stored one as newer', () => {
    expect(new Updater({ version: '6.4.2' }, {}).isNewer('6.4.3')).toBe(true);
  });

  test('does not report the stored version itself as newer', () => {
    expect(new Updater({ version: '6.4.3' }, {}).isNewer('6.4.3')).toBe(false);
  });

  test('does not report a version below the stored one as newer', () => {
    expect(new Updater({ version: '6.4.3' }, {}).isNewer('6.4.2')).toBe(false);
  });

  test('compares parts numerically', () => {
    expect(new Updater({ version: '6.9.0' }, {}).isNewer('6.10.0')).toBe(true);
  });
});

describe('mergeSettings', () => {
  test('fills in the defaults the stored settings are missing', async () => {
    const currentSettings = { version: '6.4.2' };
    const updater = new Updater(currentSettings, { version: '6.4.3', enableExtension: true });

    await updater.mergeSettings();

    expect(currentSettings.enableExtension).toBe(true);
  });

  test('keeps a stored value rather than overwriting it with the default', async () => {
    const currentSettings = { enableExtension: false };

    await new Updater(currentSettings, { enableExtension: true }).mergeSettings();

    expect(currentSettings.enableExtension).toBe(false);
  });

  test('keeps a stored false, zero or empty string, which are values a user chose', async () => {
    // Only `undefined` counts as missing — a falsy check here would quietly
    // reset every switch the user turned off.
    const currentSettings = { enableExtension: false, downloadRelativeLocation: '', maxDownloadTasks: 0 };

    await new Updater(currentSettings, {
      enableExtension: true,
      downloadRelativeLocation: 'pixiv',
      maxDownloadTasks: 3
    }).mergeSettings();

    expect(currentSettings).toMatchObject({
      enableExtension: false,
      downloadRelativeLocation: '',
      maxDownloadTasks: 0
    });
  });

  test('applies the overrides over the stored settings', async () => {
    const currentSettings = { version: '6.4.2', enableExtension: false };

    await new Updater(currentSettings, { version: '6.4.3', enableExtension: false })
      .mergeSettings({ version: '6.4.3' });

    expect(currentSettings.version).toBe('6.4.3');
  });

  test('writes the merged settings to storage', async () => {
    await new Updater({ version: '6.4.2' }, { version: '6.4.3', enableExtension: true })
      .mergeSettings({ version: '6.4.3' });

    expect(browser.storage.local.items).toMatchObject({ version: '6.4.3', enableExtension: true });
  });

  test('removes stored keys the defaults no longer carry', async () => {
    await browser.storage.local.set({ downloadMode: 'zip', enableExtension: true });

    const currentSettings = { downloadMode: 'zip', enableExtension: true };

    await new Updater(currentSettings, { enableExtension: true }).mergeSettings();

    expect(browser.storage.local.items).toEqual({ enableExtension: true });
    expect(currentSettings.downloadMode).toBe('zip');
  });

  test('leaves the stored object holding the retired key, so only storage is cleaned', async () => {
    // `remove` is given the retired keys but `currentSettings` is never pruned,
    // and it is the same object the caller keeps using after the merge.
    const currentSettings = { downloadMode: 'zip' };

    await new Updater(currentSettings, {}).mergeSettings();

    expect(currentSettings).toEqual({ downloadMode: 'zip' });
  });

  test('keeps a key introduced by the overrides when the defaults have it', async () => {
    const currentSettings = {};

    await new Updater(currentSettings, { version: '6.4.3' }).mergeSettings({ version: '6.4.3' });

    expect(browser.storage.local.items).toEqual({ version: '6.4.3' });
  });

  test('resolves only after both storage calls have run', async () => {
    const order = [];

    browser.storage.local.set.mockImplementationOnce((items, callback) => {
      order.push('set');
      callback();
    });

    browser.storage.local.remove.mockImplementationOnce((keys, callback) => {
      order.push('remove');
      callback();
    });

    await new Updater({ retired: true }, { version: '6.4.3' }).mergeSettings();

    expect(order).toEqual(['set', 'remove']);
  });
});
