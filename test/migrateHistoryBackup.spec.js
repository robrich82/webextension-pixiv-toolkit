/**
 * The 6.4.7 update's handling of the v5 `historyBackup` setting: imported into
 * the History page only when the v5 PouchDB store gave nothing, then removed.
 * Runs the real update against the fake storage, the in-memory PouchDB and
 * Dexie.
 */
import './helpers/fakeIndexedDb';
import PouchDB from 'pouchdb';
import browser from './doubles/browser';
import Application from '@/background/Application';
import SettingService from '@/background/services/SettingService';
import HistoryService from '@/background/services/HistoryService';
import Db from '@/modules/Db/Db';
import HistoryRepo from '@/modules/Db/Repository/HistoryRepo';
import update6_4_7 from '@/background/updates/update6_4_7';
import migrateHistoryBackup from '@/background/modules/migrateHistoryBackup';

const v5 = (id, viewed_at, overrides) => ({
  id: String(id), title: `Old ${id}`, userName: `Artist ${id}`, type: 0, r: false,
  images: { thumb: `https://i.pximg.net/${id}.jpg` }, viewed_at, ...overrides
});

const storedUids = async () =>
  (await Db.getDb().historyRepo().getItems({ page: 1, count: 100 })).map(item => item.uid);

describe('the 6.4.7 historyBackup migration', () => {
  let app;

  beforeEach(() => {
    Application.instance = undefined;
    SettingService.instance = undefined;
    HistoryService.instance = undefined;
    Db.instance = undefined;
    HistoryRepo.instance = undefined;

    app = Application.createApp();
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(async () => {
    await new PouchDB('illust_histories').destroy();
    await Db.getDb().database.delete();
    jest.restoreAllMocks();
  });

  test('without a PouchDB store, imports the backup into the History page and removes the setting', async () => {
    await browser.storage.local.set({ historyBackup: [v5(1, 100), v5(2, 300)], language: 'ja' });

    await update6_4_7();

    expect(await storedUids()).toEqual(['pixiv_illust:2', 'pixiv_illust:1']);
    expect(await browser.storage.local.get(null)).toEqual({ language: 'ja' });
  });

  test('with a PouchDB store, removes the backup without importing it, so entries deleted in v5 stay deleted', async () => {
    // v5's single-entry delete removed the doc from PouchDB but never from the backup.
    await new PouchDB('illust_histories').bulkDocs([{ _id: '1', ...v5(1, 100) }]);
    await browser.storage.local.set({ historyBackup: [v5(1, 100), v5(2, 300)] });

    await update6_4_7();

    expect(await storedUids()).toEqual(['pixiv_illust:1']);
    expect('historyBackup' in browser.storage.local.items).toBe(false);
  });

  test('when the PouchDB move fails, falls back to the backup', async () => {
    await browser.storage.local.set({ historyBackup: [v5(1, 100)] });

    await migrateHistoryBackup(app.getService('setting'), app.getService('history'), null);

    expect(await storedUids()).toEqual(['pixiv_illust:1']);
    expect('historyBackup' in browser.storage.local.items).toBe(false);
  });

  test('falls back to the backup when no PouchDB entry was usable', async () => {
    await browser.storage.local.set({ historyBackup: [v5(1, 100)] });

    await migrateHistoryBackup(app.getService('setting'), app.getService('history'), { imported: 0, skipped: 3 });

    expect(await storedUids()).toEqual(['pixiv_illust:1']);
  });

  test('merges with history the user already has', async () => {
    await Db.getDb().historyRepo().importItems([
      { uid: 'pixiv_illust:1', title: 'New 1', url: 'https://www.pixiv.net/artworks/1', cover: '', type: 'pixiv_illust', visited_at: 500 }
    ]);
    await browser.storage.local.set({ historyBackup: [v5(1, 100), v5(2, 300)] });

    await update6_4_7();

    expect(await storedUids()).toEqual(['pixiv_illust:1', 'pixiv_illust:2']);
  });

  test('skips entries that are not usable history, and still removes the setting', async () => {
    await browser.storage.local.set({ historyBackup: [v5(1, 100), { id: 2 }, null] });

    await update6_4_7();

    expect(await storedUids()).toEqual(['pixiv_illust:1']);
    expect('historyBackup' in browser.storage.local.items).toBe(false);
  });

  test('removes an empty backup', async () => {
    await browser.storage.local.set({ historyBackup: [] });

    await update6_4_7();

    expect(await storedUids()).toEqual([]);
    expect('historyBackup' in browser.storage.local.items).toBe(false);
  });

  test('does nothing when there is no backup', async () => {
    await browser.storage.local.set({ language: 'ja' });

    await update6_4_7();

    expect(await storedUids()).toEqual([]);
    expect(await browser.storage.local.get(null)).toEqual({ language: 'ja' });
  });

  test('keeps the setting when the import fails', async () => {
    const history = { importItems: jest.fn().mockRejectedValue(new Error('closed')) };
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await browser.storage.local.set({ historyBackup: [v5(1, 100)] });

    await migrateHistoryBackup(app.getService('setting'), history, { imported: 0, skipped: 0 });

    expect(browser.storage.local.items.historyBackup).toEqual([v5(1, 100)]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('history backup'), expect.any(Error));
  });

  test('runs when an install updates from 6.4.6 to 6.4.7', async () => {
    browser._fake.setManifest({ version: '6.4.7', manifest_version: 3 });
    await browser.storage.local.set({ version: '6.4.6', historyBackup: [v5(1, 100)] });

    await app.onInstalled({ reason: 'update' });

    expect(await storedUids()).toEqual(['pixiv_illust:1']);
    expect(await browser.storage.local.get(null)).toEqual({ version: '6.4.7' });
  });
});
