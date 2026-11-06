/**
 * The 6.4.7 migration, which clears the `ugoiraConvertTool` and
 * `maxDownloadRecords` settings left inert once nothing read them any more.
 */
const browser = require('./doubles/browser').default;
const Application = require('../src/background/Application').default;
const SettingService = require('../src/background/services/SettingService').default;
const defaultSettings = require('../src/config/default').default;
const update6_4_7 = require('../src/background/updates/update6_4_7').default;

beforeEach(() => {
  Application.instance = undefined;
  SettingService.instance = undefined;

  Application.createApp();
});

test.each(['ugoiraConvertTool', 'maxDownloadRecords'])('removes %s rather than blanking it', async key => {
  await browser.storage.local.set({ [key]: 'stale', language: 'ja' });

  await update6_4_7();

  /**
   * `in`, not a truthiness check: writing `undefined` over the key would
   * leave it in storage and read back as a present-but-empty setting.
   */
  expect(key in browser.storage.local.items).toBe(false);
});

test.each(['ugoiraConvertTool', 'maxDownloadRecords'])('fresh installs no longer get %s', key => {
  expect(defaultSettings).not.toHaveProperty(key);
});

test('leaves every other setting alone', async () => {
  await browser.storage.local.set({
    ugoiraConvertTool: 'default', maxDownloadRecords: 10000, language: 'ja', downloadSaveMode: 1
  });

  await update6_4_7();

  expect(await browser.storage.local.get(null)).toEqual({ language: 'ja', downloadSaveMode: 1 });
});

test('is a no-op when the key was never there', async () => {
  await browser.storage.local.set({ language: 'ja' });

  await update6_4_7();

  expect(await browser.storage.local.get(null)).toEqual({ language: 'ja' });
});

test('the removal has landed by the time it resolves', async () => {
  await browser.storage.local.set({ ugoiraConvertTool: 'ffmpeg' });

  await update6_4_7();

  expect(browser.storage.local.items.ugoiraConvertTool).toBeUndefined();
});
