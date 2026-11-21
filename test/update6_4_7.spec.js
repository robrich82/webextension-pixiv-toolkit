/**
 * The 6.4.7 migration, which clears settings left inert once nothing read
 * them any more, and repairs the old `mangaRenameRule` default.
 */
// The update also runs the history migrations, which open IndexedDB.
import './helpers/fakeIndexedDb';
import browser from './doubles/browser';
import Application from '../src/background/Application';
import SettingService from '../src/background/services/SettingService';
import defaultSettings from '../src/config/default';
import update6_4_7 from '../src/background/updates/update6_4_7';

const REMOVED = [
  'ugoiraConvertTool', 'maxDownloadRecords', 'ugoiraCustomFFmpegCommand',
  'ugoiraFFmpegGIFCliArgs', 'ugoiraFFmpegAPNGCliArgs', 'ugoiraFFmpegWEBMCliArgs', 'ugoiraFFmpegMP4CliArgs'
];

beforeEach(() => {
  Application.instance = undefined;
  SettingService.instance = undefined;

  Application.createApp();
});

test.each(REMOVED)('removes %s rather than blanking it', async key => {
  await browser.storage.local.set({ [key]: 'stale', language: 'ja' });

  await update6_4_7();

  /**
   * `in`, not a truthiness check: writing `undefined` over the key would
   * leave it in storage and read back as a present-but-empty setting.
   */
  expect(key in browser.storage.local.items).toBe(false);
});

test.each([...REMOVED, 'historyBackup'])('fresh installs no longer get %s', key => {
  expect(defaultSettings).not.toHaveProperty(key);
});

test('leaves every other setting alone', async () => {
  await browser.storage.local.set({
    ugoiraConvertTool: 'default', maxDownloadRecords: 10000, ugoiraCustomFFmpegCommand: '-f concat -i input.txt out.gif',
    ugoiraFFmpegGIFCliArgs: '-f concat -i input.txt -plays 0 out.gif',
    ugoiraFFmpegAPNGCliArgs: '-f concat -i input.txt -plays 0 output.apng',
    ugoiraFFmpegWEBMCliArgs: '-f concat -i input.txt -safe 0 output.webm',
    ugoiraFFmpegMP4CliArgs: '-f concat -i input.txt -safe 0 output.mp4',
    language: 'ja', downloadSaveMode: 1
  });

  await update6_4_7();

  expect(await browser.storage.local.get(null)).toEqual({ language: 'ja', downloadSaveMode: 1 });
});

test('an update from 6.4.6 clears them through onInstalled', async () => {
  browser._fake.setManifest({ version: '6.4.7', manifest_version: 3 });
  await browser.storage.local.set({
    ...Object.fromEntries(REMOVED.map(key => [key, 'stale'])), version: '6.4.6', language: 'ja'
  });

  await Application.app().onInstalled({ reason: 'update' });

  expect(REMOVED.filter(key => key in browser.storage.local.items)).toEqual([]);
  expect(browser.storage.local.items).toMatchObject({ version: '6.4.7', language: 'ja' });
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

describe('mangaRenameRule (#309)', () => {
  test('rewrites the old default, which had a stray "}"', async () => {
    await browser.storage.local.set({ mangaRenameRule: '{id}_{title}}', language: 'ja' });

    await update6_4_7();

    expect(await browser.storage.local.get(null)).toEqual({ mangaRenameRule: '{id}_{title}', language: 'ja' });
  });

  test('fresh installs get the fixed default', () => {
    expect(defaultSettings.mangaRenameRule).toBe('{id}_{title}');
  });

  test.each(['{id}_{title}', '{userName}/{id}_{title}}', ''])('leaves a rule the user set alone: %j', async rule => {
    await browser.storage.local.set({ mangaRenameRule: rule });

    await update6_4_7();

    expect(browser.storage.local.items.mangaRenameRule).toBe(rule);
  });

  test('does not add the rule when it was never stored', async () => {
    await browser.storage.local.set({ language: 'ja' });

    await update6_4_7();

    expect('mangaRenameRule' in browser.storage.local.items).toBe(false);
  });
});
