/**
 * The 6.4.3 migration, which clears the `downloadMode` setting left inert by
 * the removal of the legacy downloader.
 */
import browser from './doubles/browser';
import Application from '../src/background/Application';
import SettingService from '../src/background/services/SettingService';
import update6_4_3 from '../src/background/updates/update6_4_3';

beforeEach(() => {
  Application.instance = undefined;
  SettingService.instance = undefined;

  Application.createApp();
});

test('removes the key rather than blanking it', async () => {
  await browser.storage.local.set({ downloadMode: 1, language: 'ja' });

  await update6_4_3();

  /**
   * `in`, not a truthiness check: writing `undefined` over the key would
   * leave it in storage and read back as a present-but-empty setting.
   */
  expect('downloadMode' in browser.storage.local.items).toBe(false);
});

test('leaves every other setting alone', async () => {
  await browser.storage.local.set({ downloadMode: 2, language: 'ja', downloadSaveMode: 1 });

  await update6_4_3();

  expect(await browser.storage.local.get(null)).toEqual({ language: 'ja', downloadSaveMode: 1 });
});

test('is a no-op when the key was never there', async () => {
  await browser.storage.local.set({ language: 'ja' });

  await update6_4_3();

  expect(await browser.storage.local.get(null)).toEqual({ language: 'ja' });
});

test('the removal has landed by the time it resolves', async () => {
  await browser.storage.local.set({ downloadMode: 1 });

  await update6_4_3();

  expect(browser.storage.local.items.downloadMode).toBeUndefined();
});
