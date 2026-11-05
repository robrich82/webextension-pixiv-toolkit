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
