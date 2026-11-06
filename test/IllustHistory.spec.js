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

test('getIllusts rejects when the query fails instead of resolving undefined', async () => {
  jest.spyOn(history.db, 'find').mockRejectedValueOnce(new Error('boom'));

  await expect(history.getIllusts()).rejects.toThrow('boom');
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

  test('evicts by viewed_at, not by id or insertion order', async () => {
    const viewedAt = { 1: 50, 2: 10, 3: 40, 4: 20, 5: 30 };

    for (const id of [1, 2, 3, 4, 5]) {
      await history.putIllust(illust(id, 1700000000 + viewedAt[id]));
    }

    expect(await ids()).toEqual(['1', '3', '5']);
  });

  test('concurrent puts trim to exactly max, not below it', async () => {
    await Promise.all([1, 2, 3, 4, 5, 6].map(i => history.putIllust(illust(i, 1700000000 + i))));

    expect(await ids()).toEqual(['4', '5', '6']);
  });

  test('a second trim waits for the first instead of counting its victims again', async () => {
    history.maxLimit = 100;
    for (let i = 1; i <= 5; i++) {
      await history.putIllust(illust(i, 1700000000 + i));
    }
    history.maxLimit = 3;

    /**
     * Force the bad interleave: the second trim's lookup of what to delete
     * only runs once the first trim has finished deleting. Unserialised, the
     * second trim has already counted 5 and removes 2 more.
     */
    let firstTrimDone;
    const firstTrim = new Promise(resolve => { firstTrimDone = resolve; });
    const realTrim = history.trim.bind(history);
    const realGetIllusts = history.getIllusts.bind(history);
    let trims = 0;
    let lookups = 0;

    jest.spyOn(history, 'trim').mockImplementation(async () => {
      const mine = ++trims;
      await realTrim();
      if (mine === 1) firstTrimDone();
    });
    jest.spyOn(history, 'getIllusts').mockImplementation(async option => {
      if (++lookups === 2) await firstTrim;
      return realGetIllusts(option);
    });

    await Promise.all([history.queueTrim(), history.queueTrim()]);

    expect(await ids()).toEqual(['3', '4', '5']);
  });

  test('a max stored as a string still caps', async () => {
    history.maxLimit = '3';

    for (let i = 1; i <= 4; i++) {
      await history.putIllust(illust(i, 1700000000 + i));
    }

    expect(await ids()).toEqual(['2', '3', '4']);
  });

  test.each([0, -1, NaN, undefined, 'abc'])('a max of %p means no cap', async max => {
    history.maxLimit = max;

    for (let i = 1; i <= 4; i++) {
      await history.putIllust(illust(i, 1700000000 + i));
    }

    expect(await ids()).toEqual(['1', '2', '3', '4']);
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
