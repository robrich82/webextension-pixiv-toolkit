/**
 * IllustHistory against a real PouchDB on the in-memory adapter
 * (test/doubles/pouchdb.js), find plugin included.
 */
const IllustHistory = require('../src/repositories/IllustHistory').default;

const illust = (id, viewedAt, extra = {}) => ({
  id: String(id),
  title: `title ${id}`,
  type: 0,
  r: false,
  images: { thumb: `thumb-${id}.jpg` },
  viewed_at: viewedAt,
  ...extra
});

let history;

beforeEach(async () => {
  history = new IllustHistory({ max: 10000 });
  await history.init();
});

afterEach(async () => {
  await history.db.destroy();
});

test('putIllust stores an illust under its id', async () => {
  await history.putIllust(illust(1, 1700000000));

  expect(await history.db.get('1')).toMatchObject({ _id: '1', title: 'title 1', viewed_at: 1700000000 });
});

test('putIllust updates an existing illust in place', async () => {
  await history.putIllust(illust(1, 1700000000));
  await history.putIllust(illust(1, 1700000500, { title: 'renamed' }));

  expect(await history.db.get('1')).toMatchObject({ title: 'renamed', viewed_at: 1700000500 });
  expect(await history.getIllusts()).toHaveLength(1);
});

test('putIllust skips data checkData rejects', async () => {
  await history.putIllust(illust('not-an-id', 1700000000));

  expect(await history.getIllusts()).toEqual([]);
});

test('getIllusts returns the newest first through the viewed_at index', async () => {
  await history.putIllust(illust(1, 1700000100));
  await history.putIllust(illust(2, 1700000300));
  await history.putIllust(illust(3, 1700000200));

  expect((await history.getIllusts()).map(doc => doc.id)).toEqual(['2', '3', '1']);
});

describe('the max cap', () => {
  const ids = async () => (await history.getIllusts()).map(doc => doc.id).sort();

  beforeEach(async () => {
    await history.db.destroy();
    history = new IllustHistory({ max: 3 });
    await history.init();
  });

  test('keeps exactly the newest max illusts', async () => {
    for (let i = 1; i <= 5; i++) {
      await history.putIllust(illust(i, 1700000000 + i));
    }

    expect(await ids()).toEqual(['3', '4', '5']);
  });

  test('revisiting a stored illust at the cap evicts nothing', async () => {
    for (let i = 1; i <= 3; i++) {
      await history.putIllust(illust(i, 1700000000 + i));
    }

    await history.putIllust(illust(2, 1700000100));

    expect(await ids()).toEqual(['1', '2', '3']);
  });

  test('another index does not take an illust slot', async () => {
    await history.db.createIndex({ index: { fields: ['title'] } });

    for (let i = 1; i <= 4; i++) {
      await history.putIllust(illust(i, 1700000000 + i));
    }

    expect(await ids()).toEqual(['2', '3', '4']);
  });

  test('a failed trim is logged and still resolves the put', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(history.db, 'allDocs').mockRejectedValueOnce(new Error('boom'));

    await expect(history.putIllust(illust(1, 1700000001))).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith('Unable to trim illust history', expect.any(Error));
    expect(await ids()).toEqual(['1']);
    error.mockRestore();
  });
});
