import '../../helpers/fakeIndexedDb';
import Db from '@/modules/Db/Db';
import TrackedErrorRepo from '@/modules/Db/Repository/TrackedErrorRepo';

// TrackedErrorRepo is the one repository that runs on AbstractRepo's own
// addItem/deleteItem; HistoryRepo overrides the add.
describe('TrackedErrorRepo (Dexie)', () => {
  let repo;
  let table;

  beforeEach(() => {
    Db.instance = undefined;
    TrackedErrorRepo.instance = undefined;
    repo = Db.getDb().trackedErrorRepo();
    table = Db.getDb().database.tracked_errors;
  });

  afterEach(async () => {
    await Db.getDb().database.delete();
  });

  test('stores only the error and its time', async () => {
    await repo.addItem({ error: 'boom', created_at: 100, extra: 'dropped' });

    const rows = await table.toArray();
    expect(rows).toEqual([{ id: expect.any(Number), error: 'boom', created_at: 100 }]);
  });

  // DownloadService passes the Error that tabs.get() rejected with.
  test('stores an Error object as the caller passes it', async () => {
    await repo.addItem({ error: new Error('No tab with id: 7'), created_at: 100 });

    const [row] = await table.toArray();
    // Jest's sandbox has its own Error, so check the shape, not instanceof.
    expect(row.error).toMatchObject({ name: 'Error', message: 'No tab with id: 7' });
  });

  test('keeps at most max entries, dropping the oldest', async () => {
    repo.setMax(3);

    for (let i = 1; i <= 5; i++) {
      await repo.addItem({ error: `e${i}`, created_at: i });
    }

    expect((await table.toArray()).map(row => row.error)).toEqual(['e3', 'e4', 'e5']);
  });

  test('defaults to a cap of 500', () => {
    expect(repo.max).toBe(500);
  });

  test('rejects when the entry cannot be stored', async () => {
    await expect(repo.addItem({ error: () => {}, created_at: 1 })).rejects.toThrow();
    expect(await table.count()).toBe(0);
  });

  test('deleteItem removes that entry', async () => {
    await repo.addItem({ error: 'a', created_at: 1 });
    await repo.addItem({ error: 'b', created_at: 2 });
    const [first] = await table.toArray();

    await repo.deleteItem(first.id);

    expect((await table.toArray()).map(row => row.error)).toEqual(['b']);
  });

  test('getItem finds an entry by an indexed field, clear empties the table', async () => {
    await repo.addItem({ error: 'a', created_at: 1 });

    expect(await repo.getItem({ created_at: 1 })).toMatchObject({ error: 'a' });

    await repo.clear();
    expect(await table.count()).toBe(0);
  });
});
