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
  jest.restoreAllMocks();
  await history.db.destroy();
});

const flush = () => new Promise(resolve => setTimeout(resolve, 10));

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

  /** Five illusts stored over a cap of 3, with no trim run yet. */
  const overCap = async () => {
    history.maxLimit = 100;
    for (let i = 1; i <= 5; i++) {
      await history.putIllust(illust(i, 1700000000 + i));
    }
    history.maxLimit = 3;
  };

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

  test('concurrent puts end at the newest max', async () => {
    await Promise.all([1, 2, 3, 4, 5, 6].map(i => history.putIllust(illust(i, 1700000000 + i))));

    expect(await ids()).toEqual(['4', '5', '6']);
  });

  test('a second trim counts only after the first has finished deleting', async () => {
    await overCap();

    // Hold the second trim's lookup until the first trim settles. Unserialised,
    // the second trim has already counted 5 by then and removes 2 more.
    let firstTrimSettled;
    const firstTrim = new Promise(resolve => { firstTrimSettled = resolve; });
    const realTrim = history.trim.bind(history);
    const realGetIllusts = history.getIllusts.bind(history);

    jest.spyOn(history, 'trim').mockImplementationOnce(() => realTrim().finally(firstTrimSettled));
    jest.spyOn(history, 'getIllusts')
      .mockImplementationOnce(realGetIllusts)
      .mockImplementationOnce(option => firstTrim.then(() => realGetIllusts(option)));

    await Promise.all([history.queueTrim(), history.queueTrim()]);

    expect(await ids()).toEqual(['3', '4', '5']);
  });

  test('a conflicting remove neither releases the queue early nor logs', async () => {
    await overCap();
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const realRemove = history.db.remove.bind(history.db);
    let releaseSecond;
    let secondStarted;
    const secondHeld = new Promise(resolve => { releaseSecond = resolve; });
    const removing = new Promise(resolve => { secondStarted = resolve; });

    // Illust 1 was revisited after the lookup; illust 2's remove is still running.
    jest.spyOn(history.db, 'remove').mockImplementation(doc => {
      if (doc._id === '1') {
        return Promise.reject(Object.assign(new Error('Document update conflict'), { status: 409 }));
      }
      secondStarted();
      return secondHeld.then(() => realRemove(doc));
    });

    let settled = false;
    const trimmed = history.queueTrim().then(() => { settled = true; });
    await removing;
    await flush();

    expect(settled).toBe(false);

    releaseSecond();
    await trimmed;

    expect(await ids()).toEqual(['1', '3', '4', '5']);
    expect(error).not.toHaveBeenCalled();
  });

  test('any other remove failure is logged', async () => {
    await overCap();
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const failure = Object.assign(new Error('quota'), { status: 500 });
    jest.spyOn(history.db, 'remove').mockRejectedValueOnce(failure);

    await history.queueTrim();

    expect(error).toHaveBeenCalledWith('Unable to trim illust history', failure);
  });

  test('clearData waits for a trim in flight', async () => {
    await overCap();
    const realAllDocs = history.db.allDocs.bind(history.db);
    let releaseCount;
    const countHeld = new Promise(resolve => { releaseCount = resolve; });
    jest.spyOn(history.db, 'allDocs').mockImplementationOnce((...args) => countHeld.then(() => realAllDocs(...args)));
    const remove = jest.spyOn(history.db, 'remove');
    const destroy = jest.spyOn(history.db, 'destroy');
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const trimmed = history.queueTrim();
    const cleared = history.clearData();
    await flush();

    expect(destroy).not.toHaveBeenCalled();

    releaseCount();
    await Promise.all([trimmed, cleared]);

    // The trim finished its removes on the old database before it was destroyed.
    expect(remove).toHaveBeenCalledTimes(2);
    expect(Math.max(...remove.mock.invocationCallOrder)).toBeLessThan(destroy.mock.invocationCallOrder[0]);
    expect(error).not.toHaveBeenCalled();
    expect(await ids()).toEqual([]);
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

    // The failure didn't jam the queue: later puts still trim.
    for (let i = 2; i <= 4; i++) {
      await history.putIllust(illust(i, 1700000000 + i));
    }

    expect(await ids()).toEqual(['2', '3', '4']);
  });
});
