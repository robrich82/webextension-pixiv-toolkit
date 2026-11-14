/**
 * What the Diagnosis page lists: the errors the background recorded in the
 * shared Dexie database, read straight from the options page.
 */
import './helpers/fakeIndexedDb';
import browser from './doubles/browser';
import defaultSettings from '@/config/default';
import { trackedErrorLines } from '@/options_page/modules/trackedErrors';
import BackgroundApplication from '@/background/Application';
import BackgroundDownloadService from '@/background/services/DownloadService';
import BackgroundSettingService from '@/background/services/SettingService';
import Db from '@/modules/Db/Db';
import TrackedErrorRepo from '@/modules/Db/Repository/TrackedErrorRepo';

beforeEach(() => {
  Db.instance = undefined;
  TrackedErrorRepo.instance = undefined;
});

afterEach(async () => {
  await Db.getDb().database.delete();
});

describe('trackedErrorLines', () => {
  test('is empty when nothing was recorded', async () => {
    expect(await trackedErrorLines()).toEqual([]);
  });

  test('returns the error the background recorded for a closed download manager tab', async () => {
    await browser.storage.local.set(structuredClone(defaultSettings));
    BackgroundApplication.instance = undefined;
    BackgroundDownloadService.instance = undefined;
    BackgroundSettingService.instance = undefined;
    const backgroundApp = BackgroundApplication.createApp();
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => backgroundApp.onMessage(message, sender, sendResponse));

    // The stored tab is gone, so tabs.get() rejects and the background records why.
    await browser.storage.local.set({ _download_manager_tab: { tabId: 99, windowId: 1 } });
    await browser.runtime.sendMessage({ to: 'ws', action: 'download:getDownloadManagerTab' });
    await vi.waitFor(async () => expect(await Db.getDb().database.tracked_errors.count()).toBe(1));

    const errors = await trackedErrorLines();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z Error: .*99/);
  });

  test('lists errors oldest first and prints a non-Error value as it is', async () => {
    const repo = Db.getDb().trackedErrorRepo();
    await repo.addItem({ error: new TypeError('first'), created_at: Date.UTC(2026, 0, 1) });
    await repo.addItem({ error: 'second', created_at: Date.UTC(2026, 0, 2) });

    expect(await trackedErrorLines()).toEqual([
      '2026-01-01T00:00:00.000Z TypeError: first',
      '2026-01-02T00:00:00.000Z second'
    ]);
  });

  test('still lists an error whose time is missing', async () => {
    await Db.getDb().trackedErrorRepo().addItem({ error: new Error('no time') });

    expect(await trackedErrorLines()).toEqual(['Error: no time']);
  });

  test('rejects when the database cannot be read', async () => {
    Db.getDb().database.close();

    await expect(trackedErrorLines()).rejects.toMatchObject({ name: 'DatabaseClosedError' });
  });
});
