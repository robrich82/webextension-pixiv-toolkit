/**
 * The X.Y.Z migration, which <one line on what it does>.
 */
import browser from './doubles/browser';
import Application from '../src/background/Application';
import SettingService from '../src/background/services/SettingService';
import updateX_Y_Z from '../src/background/updates/updateX_Y_Z';

beforeEach(() => {
  Application.instance = undefined;
  SettingService.instance = undefined;

  Application.createApp();
});

test('moves the old value to the new key', async () => {
  await browser.storage.local.set({ oldKey: 'value' });

  await updateX_Y_Z();

  expect('oldKey' in browser.storage.local.items).toBe(false);
  expect(browser.storage.local.items.newKey).toBe('value');
});

test('keeps an existing new value over the old one', async () => {
  await browser.storage.local.set({ oldKey: 'stale', newKey: 'chosen' });

  await updateX_Y_Z();

  expect(await browser.storage.local.get(null)).toEqual({ newKey: 'chosen' });
});

test('leaves every other setting alone', async () => {
  await browser.storage.local.set({ oldKey: 'value', language: 'ja' });

  await updateX_Y_Z();

  expect(await browser.storage.local.get(null)).toEqual({ newKey: 'value', language: 'ja' });
});

test('is a no-op when the key was never there', async () => {
  await browser.storage.local.set({ language: 'ja' });

  await updateX_Y_Z();

  /**
   * `in`, not `toEqual` alone: the double's `get` drops undefined values, so
   * a stray `newKey: undefined` write would otherwise go unnoticed.
   */
  expect('newKey' in browser.storage.local.items).toBe(false);
  expect(await browser.storage.local.get(null)).toEqual({ language: 'ja' });
});
