import '../../helpers/fakeIndexedDb';
import Db from '@/modules/Db/Db';
import HistoryRepo from '@/modules/Db/Repository/HistoryRepo';

const item = (id, visited_at, overrides) => ({
  uid: `pixiv_illust:${id}`, title: `Work ${id}`, userName: `Artist ${id}`,
  url: `https://www.pixiv.net/artworks/${id}`, cover: `${id}.jpg`,
  type: 'pixiv_illust', r: false, visited_at, ...overrides
});

const uids = items => items.map(i => i.uid);

describe('HistoryRepo (Dexie)', () => {
  let repo;

  beforeEach(() => {
    Db.instance = undefined;
    HistoryRepo.instance = undefined;
    repo = Db.getDb().historyRepo();
  });

  afterEach(async () => {
    await Db.getDb().database.delete();
  });

  test('lists the most recently visited first, whatever order they were stored in', async () => {
    await repo.saveItem(item(1, 300));
    await repo.saveItem(item(2, 100));
    await repo.saveItem(item(3, 200));

    expect(uids(await repo.getItems({ page: 1 }))).toEqual(['pixiv_illust:1', 'pixiv_illust:3', 'pixiv_illust:2']);
  });

  test('a revisit moves the entry to the top', async () => {
    await repo.saveItem(item(1, 100));
    await repo.saveItem(item(2, 200));

    await repo.saveItem(item(1, 300));

    let items = await repo.getItems({ page: 1 });
    expect(uids(items)).toEqual(['pixiv_illust:1', 'pixiv_illust:2']);
    expect(items[0].visited_at).toBe(300);
  });

  test('a download-only entry is listed by its download time', async () => {
    await repo.saveItem(item(1, 200));
    await repo.saveItem(item(2, undefined, { downloaded_at: 300 }));

    expect(uids(await repo.getItems({ page: 1 }))).toEqual(['pixiv_illust:2', 'pixiv_illust:1']);
  });

  test('pages through the visit order', async () => {
    for (let i = 1; i <= 5; i++) {
      await repo.saveItem(item(i, i * 100));
    }

    expect(uids(await repo.getItems({ page: 1, count: 2 }))).toEqual(['pixiv_illust:5', 'pixiv_illust:4']);
    expect(uids(await repo.getItems({ page: 3, count: 2 }))).toEqual(['pixiv_illust:1']);
    expect(await repo.getItems({ page: 4, count: 2 })).toEqual([]);
  });

  test('search matches title or user name, newest visit first, and pages', async () => {
    await repo.saveItem(item(1, 100, { title: 'Cat' }));
    await repo.saveItem(item(2, 300, { title: 'Dog', userName: 'Catherine' }));
    await repo.saveItem(item(3, 200, { title: 'Cat again' }));
    await repo.saveItem(item(4, 400, { title: 'Bird' }));

    expect(uids(await repo.searchItems({ query: 'Cat', page: 1 })))
      .toEqual(['pixiv_illust:2', 'pixiv_illust:3', 'pixiv_illust:1']);
    expect(uids(await repo.searchItems({ query: 'Cat', page: 2, count: 2 }))).toEqual(['pixiv_illust:1']);
  });

  test('the cap drops the least recently visited, not the first stored', async () => {
    repo.setMax(2);

    await repo.saveItem(item(1, 300));
    await repo.saveItem(item(2, 100));
    await repo.saveItem(item(3, 200));

    expect(await repo.table.count()).toBe(2);
    expect(uids(await repo.getItems({ page: 1 }))).toEqual(['pixiv_illust:1', 'pixiv_illust:3']);
  });

  test('concurrent saves over the cap trim only the overflow', async () => {
    repo.setMax(1);

    await Promise.all([repo.saveItem(item(1, 100)), repo.saveItem(item(2, 200))]);

    expect(uids(await repo.getItems({ page: 1 }))).toEqual(['pixiv_illust:2']);
  });

  test('stays under the cap without trimming', async () => {
    repo.setMax(3);

    await repo.saveItem(item(1, 100));
    await repo.saveItem(item(2, 200));
    await repo.saveItem(item(3, 300));

    expect(await repo.table.count()).toBe(3);
  });
  test('exportItems returns every entry, newest visit first, without ids', async () => {
    await repo.saveItem(item(1, 100));
    await repo.saveItem(item(2, 200));

    expect(await repo.exportItems()).toEqual([item(2, 200), item(1, 100)]);
  });

  describe('importItems', () => {
    test('adds new entries in visit order', async () => {
      await repo.saveItem(item(1, 200));

      await repo.importItems([item(2, 100), item(3, 300)]);

      expect(uids(await repo.getItems({ page: 1 }))).toEqual(['pixiv_illust:3', 'pixiv_illust:1', 'pixiv_illust:2']);
    });

    test('merges into a stored entry, keeping its id and the later timestamps', async () => {
      await repo.table.add(item(1, 300, { title: 'Stored', downloaded_at: 250 }));
      let [stored] = await repo.getItems({ page: 1 });

      await repo.importItems([item(1, 100, { title: 'Older import' })]);

      let [merged] = await repo.getItems({ page: 1 });
      expect(await repo.table.count()).toBe(1);
      expect(merged).toMatchObject({ id: stored.id, title: 'Stored', visited_at: 300, downloaded_at: 250 });
    });

    test('a newer imported visit wins over the stored details', async () => {
      await repo.table.add(item(1, 100, { title: 'Stored', downloaded_at: 100 }));

      await repo.importItems([item(1, 400, { title: 'Renamed' })]);

      let [merged] = await repo.getItems({ page: 1 });
      expect(merged).toMatchObject({ title: 'Renamed', visited_at: 400, downloaded_at: 100 });
    });

    test('a newer import without a user name or cover keeps the stored ones', async () => {
      await repo.table.add(item(1, 100, { userName: 'Stored artist', cover: 'stored.jpg' }));

      await repo.importItems([item(1, 400, { userName: undefined, cover: '' })]);

      let [merged] = await repo.getItems({ page: 1 });
      expect(merged).toMatchObject({ userName: 'Stored artist', cover: 'stored.jpg', visited_at: 400 });
    });

    test('merges a work that appears twice in one import', async () => {
      await repo.importItems([item(1, 100, { downloaded_at: 150 }), item(1, 200)]);

      let items = await repo.getItems({ page: 1 });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ visited_at: 200, downloaded_at: 150 });
    });

    test('trims to the cap, dropping the oldest visits', async () => {
      repo.setMax(2);
      await repo.saveItem(item(1, 500));

      await repo.importItems([item(2, 100), item(3, 400), item(4, 200)]);

      expect(uids(await repo.getItems({ page: 1 }))).toEqual(['pixiv_illust:1', 'pixiv_illust:3']);
    });
  });
});
