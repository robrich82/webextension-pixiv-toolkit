/**
 * The download manager page's LogService, reached the way the Diagnosis page
 * reaches it: `runtime.sendMessage` into DownloadsApplication.onMessage. It
 * reads the errors the background recorded in the shared Dexie database.
 */
import './helpers/fakeIndexedDb';
import browser from './doubles/browser';
import defaultSettings from '@/config/default';
import Application from '@/options_page/DownloadsApplication';
import DownloadsBootstrap from '@/options_page/DownloadsBootstrap';
import LogService from '@/options_page/services/LogService';
import SettingService from '@/options_page/services/SettingService';
import BackgroundApplication from '@/background/Application';
import BackgroundDownloadService from '@/background/services/DownloadService';
import BackgroundSettingService from '@/background/services/SettingService';
import Db from '@/modules/Db/Db';
import TrackedErrorRepo from '@/modules/Db/Repository/TrackedErrorRepo';

const trackedErrors = () => browser.runtime.sendMessage({ action: 'log:getTrackedErrors' });

beforeEach(async () => {
  Application.instance = undefined;
  LogService.instance = undefined;
  SettingService.instance = undefined;
  Db.instance = undefined;
  TrackedErrorRepo.instance = undefined;

  await browser.storage.local.set(structuredClone(defaultSettings));

  const app = Application.createApp();
  DownloadsBootstrap.bindEvents(app);
  await app.onBeforeBoot();
});

afterEach(async () => {
  await Db.getDb().database.delete();
});

describe('log:getTrackedErrors', () => {
  test('answers with an empty list when nothing was recorded', async () => {
    expect(await trackedErrors()).toEqual([]);
  });

  test('returns the error the background recorded for a closed download manager tab', async () => {
    BackgroundApplication.instance = undefined;
    BackgroundDownloadService.instance = undefined;
    BackgroundSettingService.instance = undefined;
    const backgroundApp = BackgroundApplication.createApp();
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => backgroundApp.onMessage(message, sender, sendResponse));

    // The stored tab is gone, so tabs.get() rejects and the background records why.
    await browser.storage.local.set({ _download_manager_tab: { tabId: 99, windowId: 1 } });
    await browser.runtime.sendMessage({ to: 'ws', action: 'download:getDownloadManagerTab' });
    await vi.waitFor(async () => expect(await Db.getDb().database.tracked_errors.count()).toBe(1));

    const errors = await trackedErrors();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z Error: .*99/);
  });

  test('lists errors oldest first and prints a non-Error value as it is', async () => {
    const repo = Db.getDb().trackedErrorRepo();
    await repo.addItem({ error: new TypeError('first'), created_at: Date.UTC(2026, 0, 1) });
    await repo.addItem({ error: 'second', created_at: Date.UTC(2026, 0, 2) });

    expect(await trackedErrors()).toEqual([
      '2026-01-01T00:00:00.000Z TypeError: first',
      '2026-01-02T00:00:00.000Z second'
    ]);
  });
});
