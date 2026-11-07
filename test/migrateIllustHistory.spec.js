/**
 * The 6.4.7 update's move of the v5 visit history from the PouchDB
 * `illust_histories` store into the Dexie table the History page reads. The
 * store is written into fake-indexeddb in PouchDB's raw idb layout, either
 * as dumped from real PouchDB or built from that dump's shapes.
 */
import './helpers/fakeIndexedDb';
import Application from '@/background/Application';
import SettingService from '@/background/services/SettingService';
import HistoryService from '@/background/services/HistoryService';
import Db from '@/modules/Db/Db';
import HistoryRepo from '@/modules/Db/Repository/HistoryRepo';
import update6_4_7 from '@/background/updates/update6_4_7';
import migrateIllustHistory from '@/background/modules/migrateIllustHistory';
import {
  STORE, fixture, restoreDatabases, writeStore, databaseNames, deletePouchDatabases
} from './helpers/pouchdbV5Store';

const v5 = (id, viewed_at, overrides) => ({
  _id: String(id), id: String(id), title: `Old ${id}`, userName: `Artist ${id}`, type: 0, r: false,
  images: { thumb: `https://i.pximg.net/${id}.jpg` }, viewed_at, ...overrides
});

const storedUids = async () =>
  (await Db.getDb().historyRepo().getItems({ page: 1, count: 100 })).map(item => item.uid);

describe('migrateIllustHistory', () => {
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
    await deletePouchDatabases();
    await Db.getDb().database.delete();
    jest.restoreAllMocks();
  });

  describe('a store written by PouchDB 7.2.2, as v5 used it', () => {
    test('imports what PouchDB itself listed: winning revisions only, no deleted or design docs', async () => {
      await restoreDatabases();
      const importItems = jest.spyOn(app.getService('history'), 'importItems');

      await migrateIllustHistory(app.getService('history'));

      const sortById = docs => [...docs].sort((a, b) => a._id.localeCompare(b._id));
      expect(sortById(importItems.mock.calls[0][0].items)).toEqual(sortById(fixture.allDocs));
    });

    test('moves the entries into the History page', async () => {
      await restoreDatabases();

      expect(await migrateIllustHistory(app.getService('history'))).toEqual({ imported: 5, skipped: 0 });

      expect(await storedUids()).toEqual([
        'pixiv_illust:1001', 'pixiv_illust:1006', 'pixiv_illust:1005', 'pixiv_novel:3003', 'pixiv_illust:1002'
      ]);
      expect((await Db.getDb().historyRepo().getItems({ page: 1 }))[0]).toMatchObject({
        title: 'Illust 1001', visited_at: 1600000010, cover: 'https://i.pximg.net/c/250x250/img/1001_p0.jpg'
      });
    });

    test('deletes the store and its pouchdb-find index database, as destroy() did', async () => {
      await restoreDatabases();
      expect(await databaseNames()).toEqual(fixture.databases.map(db => db.name));
      expect(fixture.databases).toHaveLength(2);

      await migrateIllustHistory(app.getService('history'));

      expect((await databaseNames()).filter(name => name.startsWith('_pouch_'))).toEqual([]);
    });
  });

  test("writeStore's records have the shape PouchDB wrote", async () => {
    const real = fixture.databases.find(db => db.name === STORE).stores;
    const keysOf = (records, id) => Object.keys(records.find(([key]) => key === id)[1]).sort();

    await writeStore([v5(1001, 1)]);
    const open = indexedDB.open(STORE);
    const db = await new Promise(resolve => { open.onsuccess = () => resolve(open.result); });
    const written = await new Promise(resolve => {
      const req = db.transaction('document-store').objectStore('document-store').get('1001');
      req.onsuccess = () => resolve(req.result);
    });
    db.close();

    expect(Object.keys(written).sort()).toEqual(keysOf(real['document-store'].records, '1001'));
    expect(Object.keys(JSON.parse(written.data)).sort()).toEqual(Object.keys(JSON.parse(real['document-store'].records.find(([key]) => key === '1001')[1].data)).sort());
  });

  test('the 6.4.7 update moves the v5 history and deletes the store', async () => {
    await writeStore([
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
    expect(await databaseNames()).not.toContain(STORE);
  });

  test('skips deleted documents', async () => {
    await writeStore([v5(1, 100), { ...v5(2, 200), _deleted: true }]);

    expect(await migrateIllustHistory(app.getService('history'))).toEqual({ imported: 1, skipped: 0 });
    expect(await storedUids()).toEqual(['pixiv_illust:1']);
  });

  test('merges with history already on the History page', async () => {
    await Db.getDb().historyRepo().importItems([{
      uid: 'pixiv_illust:1', title: 'Seen since', url: 'https://www.pixiv.net/artworks/1',
      cover: '', type: 'pixiv_illust', r: false, visited_at: 500
    }]);
    await writeStore([v5(1, 100), v5(2, 200)]);

    const result = await migrateIllustHistory(app.getService('history'));

    expect(result).toEqual({ imported: 2, skipped: 0 });
    expect(await storedUids()).toEqual(['pixiv_illust:1', 'pixiv_illust:2']);
    expect((await Db.getDb().historyRepo().getItems({ page: 1 }))[0].title).toBe('Seen since');
  });

  test('skips documents that are not usable history', async () => {
    await writeStore([v5(1, 100), { _id: 'junk', title: 'no id' }]);

    expect(await migrateIllustHistory(app.getService('history'))).toEqual({ imported: 1, skipped: 1 });
  });

  test('an install with no v5 store imports nothing, and does not create one', async () => {
    expect(await migrateIllustHistory(app.getService('history'))).toEqual({ imported: 0, skipped: 0 });

    expect(await storedUids()).toEqual([]);
    expect(await databaseNames()).not.toContain(STORE);
  });

  test('reads the v5 variants: a string viewed_at, a numeric id, milliseconds', async () => {
    await writeStore([
      { ...v5(1, '1600000000'), id: 1 },
      v5(2, 1600000100123)
    ]);

    expect(await migrateIllustHistory(app.getService('history'))).toEqual({ imported: 2, skipped: 0 });
    expect((await Db.getDb().historyRepo().getItems({ page: 1 })).map(item => [item.uid, item.visited_at]))
      .toEqual([['pixiv_illust:2', 1600000100], ['pixiv_illust:1', 1600000000]]);
  });

  test('the maxHistoryItems cap drops the oldest visits, as for any import', async () => {
    app.settings.maxHistoryItems = 2;
    await writeStore([v5(1, 100), v5(2, 300), v5(3, 200)]);

    await migrateIllustHistory(app.getService('history'));

    expect(await storedUids()).toEqual(['pixiv_illust:2', 'pixiv_illust:3']);
  });

  test('a failed delete of the old store still reports the move', async () => {
    await writeStore([v5(1, 100)]);
    const deleteDatabase = jest.spyOn(indexedDB, 'deleteDatabase').mockImplementation(() => {
      throw new Error('blocked');
    });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(await migrateIllustHistory(app.getService('history'))).toEqual({ imported: 1, skipped: 0 });

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('could not delete'), expect.any(Error));
    expect(await storedUids()).toEqual(['pixiv_illust:1']);
    deleteDatabase.mockRestore();
  });

  test('a store in another schema version is kept, not guessed at', async () => {
    const schema = fixture.databases.find(db => db.name === STORE);
    await restoreDatabases([{ ...schema, version: 4 }]);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(await migrateIllustHistory(app.getService('history'))).toBeNull();

    expect(consoleError).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: expect.stringContaining('version 4') }));
    expect(await databaseNames()).toContain(STORE);
  });

  test('a failed import keeps the store, and the update still completes', async () => {
    await writeStore([v5(1, 100)]);
    jest.spyOn(app.getService('history'), 'importItems').mockRejectedValue(new Error('quota'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(update6_4_7()).resolves.toBeUndefined();

    expect(await databaseNames()).toContain(STORE);
  });

  test('a failed import keeps the store and returns null', async () => {
    await writeStore([v5(1, 100)]);
    const history = app.getService('history');
    jest.spyOn(history, 'importItems').mockRejectedValue(new Error('quota'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(await migrateIllustHistory(history)).toBeNull();

    expect(consoleError).toHaveBeenCalled();
    expect(await databaseNames()).toContain(STORE);
  });
});
