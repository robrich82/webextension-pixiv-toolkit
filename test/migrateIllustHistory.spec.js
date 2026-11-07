/**
 * The 6.4.7 update's move of the v5 visit history from the PouchDB
 * `illust_histories` store into the Dexie table the History page reads.
 * Runs the real update against the in-memory PouchDB and Dexie.
 */
import './helpers/fakeIndexedDb';
import PouchDB from 'pouchdb';
import Application from '@/background/Application';
import SettingService from '@/background/services/SettingService';
import HistoryService from '@/background/services/HistoryService';
import Db from '@/modules/Db/Db';
import HistoryRepo from '@/modules/Db/Repository/HistoryRepo';
import update6_4_7 from '@/background/updates/update6_4_7';
import migrateIllustHistory from '@/background/modules/migrateIllustHistory';

const v5 = (id, viewed_at, overrides) => ({
  _id: String(id), id: String(id), title: `Old ${id}`, userName: `Artist ${id}`, type: 0, r: false,
  images: { thumb: `https://i.pximg.net/${id}.jpg` }, viewed_at, ...overrides
});

const pouchDocs = async () => {
  const { rows } = await new PouchDB('illust_histories').allDocs();
  return rows.map(row => row.id);
};

const storedUids = async () =>
  (await Db.getDb().historyRepo().getItems({ page: 1, count: 100 })).map(item => item.uid);

describe('migrateIllustHistory', () => {
  let app;

  beforeEach(async () => {
    Application.instance = undefined;
    SettingService.instance = undefined;
    HistoryService.instance = undefined;
    Db.instance = undefined;
    HistoryRepo.instance = undefined;

    app = Application.createApp();

    const db = new PouchDB('illust_histories');
    // v5 created this index on first use, so real stores carry a design doc.
    await db.createIndex({ index: { fields: ['viewed_at'] } });
  });

  afterEach(async () => {
    await new PouchDB('illust_histories').destroy();
    await Db.getDb().database.delete();
    jest.restoreAllMocks();
  });

  test('the 6.4.7 update moves the v5 history into the History page and destroys the store', async () => {
    await new PouchDB('illust_histories').bulkDocs([
      v5(1, 100),
      v5('N2', 300, { isNovel: true, images: undefined, image: 'https://i.pximg.net/n2.jpg' }),
      v5(3, 200, { type: 2 })
    ]);

    await update6_4_7();

    expect(await storedUids()).toEqual(['pixiv_novel:2', 'pixiv_illust:3', 'pixiv_illust:1']);
    expect((await Db.getDb().historyRepo().getItems({ page: 1 }))[1]).toMatchObject({
      title: 'Old 3', userName: 'Artist 3', type: 'pixiv_ugoira',
      url: 'https://www.pixiv.net/artworks/3', cover: 'https://i.pximg.net/3.jpg', visited_at: 200
    });
    expect(await pouchDocs()).toEqual([]);
  });

  test('merges with history already on the History page', async () => {
    await Db.getDb().historyRepo().importItems([{
      uid: 'pixiv_illust:1', title: 'Seen since', url: 'https://www.pixiv.net/artworks/1',
      cover: '', type: 'pixiv_illust', r: false, visited_at: 500
    }]);
    await new PouchDB('illust_histories').bulkDocs([v5(1, 100), v5(2, 200)]);

    const result = await migrateIllustHistory(app.getService('history'));

    expect(result).toEqual({ imported: 2, skipped: 0 });
    expect(await storedUids()).toEqual(['pixiv_illust:1', 'pixiv_illust:2']);
    expect((await Db.getDb().historyRepo().getItems({ page: 1 }))[0].title).toBe('Seen since');
  });

  test('skips documents that are not usable history', async () => {
    await new PouchDB('illust_histories').bulkDocs([v5(1, 100), { _id: 'junk', title: 'no id' }]);

    expect(await migrateIllustHistory(app.getService('history'))).toEqual({ imported: 1, skipped: 1 });
  });

  test('an install with no v5 history imports nothing', async () => {
    expect(await migrateIllustHistory(app.getService('history'))).toEqual({ imported: 0, skipped: 0 });
    expect(await storedUids()).toEqual([]);
  });

  test('reads the v5 variants: a string viewed_at, a numeric id, milliseconds', async () => {
    await new PouchDB('illust_histories').bulkDocs([
      { ...v5(1, '1600000000'), id: 1 },
      v5(2, 1600000100123)
    ]);

    expect(await migrateIllustHistory(app.getService('history'))).toEqual({ imported: 2, skipped: 0 });
    expect((await Db.getDb().historyRepo().getItems({ page: 1 })).map(item => [item.uid, item.visited_at]))
      .toEqual([['pixiv_illust:2', 1600000100], ['pixiv_illust:1', 1600000000]]);
  });

  test('the maxHistoryItems cap drops the oldest visits, as for any import', async () => {
    app.settings.maxHistoryItems = 2;
    await new PouchDB('illust_histories').bulkDocs([v5(1, 100), v5(2, 300), v5(3, 200)]);

    await migrateIllustHistory(app.getService('history'));

    expect(await storedUids()).toEqual(['pixiv_illust:2', 'pixiv_illust:3']);
  });

  test('a failed delete of the old store still reports the move', async () => {
    await new PouchDB('illust_histories').bulkDocs([v5(1, 100)]);
    // PouchDB assigns destroy per instance, so it can't be spied on a prototype.
    class UndeletablePouchDB extends PouchDB {
      constructor(...args) {
        super(...args);
        this.destroy = () => Promise.reject(new Error('blocked'));
      }
    }
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(await migrateIllustHistory(app.getService('history'), UndeletablePouchDB))
      .toEqual({ imported: 1, skipped: 0 });

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('could not delete'), expect.any(Error));
    expect(await storedUids()).toEqual(['pixiv_illust:1']);
  });

  test('a failed import keeps the PouchDB store, and the update still completes', async () => {
    await new PouchDB('illust_histories').bulkDocs([v5(1, 100)]);
    jest.spyOn(app.getService('history'), 'importItems').mockRejectedValue(new Error('quota'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(update6_4_7()).resolves.toBeUndefined();

    expect(await pouchDocs()).toEqual(expect.arrayContaining(['1']));
  });

  test('a failed import keeps the PouchDB store and returns null', async () => {
    await new PouchDB('illust_histories').bulkDocs([v5(1, 100)]);
    const history = app.getService('history');
    jest.spyOn(history, 'importItems').mockRejectedValue(new Error('quota'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(await migrateIllustHistory(history)).toBeNull();

    expect(consoleError).toHaveBeenCalled();
    expect(await pouchDocs()).toEqual(expect.arrayContaining(['1']));
  });
});
