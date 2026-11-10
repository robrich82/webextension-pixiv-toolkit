/**
 * DownloadManager driving real MultiplePagesDownloadTasks. The network's only
 * stand-in is the background's end of each `DownloadFile` port
 * (fakeDownloadFileBackground), so a spec decides when each file finishes.
 */
import browser from './doubles/browser';
import { fakeDownloadFileBackground } from './helpers/downloadFileBackground';
import DownloadManager from '@/options_page/modules/DownloadManager';
import MultiplePagesDownloadTask from '@/options_page/modules/DownloadTasks/MultiplePagesDownloadTask';
import NovelDownloadTask from '@/options_page/modules/DownloadTasks/Pixiv/NovelDownloadTask';

let background;
let manager;

const page = (n, p = 0) => `https://i.pximg.net/img/${n}_p${p}.png`;

const createTask = (n, totalPages = 1) => new MultiplePagesDownloadTask({
  id: `pixiv_illust:${n}`,
  url: `https://www.pixiv.net/artworks/${n}`,
  pages: Array.from({ length: totalPages }, (_, p) => page(n, p)),
  selectedIndexes: [],
  pageNumberStartWithOne: 1,
  pageNumberLength: -1,
  renameRule: '{id}',
  renameImageRule: 'p{pageNum}',
  context: { id: `${n}`, title: `Work ${n}`, totalPages }
});

const addTasks = async (...ns) => {
  const tasks = ns.map(n => createTask(n));

  for (const task of tasks) {
    await manager.addTask(task);
  }

  await browser._fake.flush();

  return tasks;
};

const states = tasks => tasks.map(task => task.state);

beforeEach(() => {
  window.$app = {
    settings: {
      downloadSaveMode: 0,
      globalZipMultipleImages: 1,
      downloadTasksWhenDownloadingImages: 1,
      downloadRelativeLocation: '',
      enableDownloadMetadata: false,
      dontCreateWorkFolder: 0,
      combinWRRuleAndIRRuleWhenDontCreateWorkFolder: 0
    }
  };
  globalThis.JSZip = class FakeJSZip {
    file() {}

    generateAsync() {
      return Promise.resolve(new Blob(['zip']));
    }
  };

  background = fakeDownloadFileBackground();
  DownloadManager.defaultInstance = undefined;
  manager = DownloadManager.getDefault();
});

afterEach(() => {
  delete window.$app;
  delete globalThis.JSZip;
});

const FAILURE = -1;
const PENDING = 1;
const DOWNLOADING = 2;
const COMPLETE = 4;

test('getDefault hands back one shared manager', () => {
  expect(DownloadManager.getDefault()).toBe(manager);
});

test('starts no more than maxDownloadingTasks at once, and queues the rest', async () => {
  manager.setMaxDownloadingTasks(2);

  const tasks = await addTasks(1, 2, 3);

  expect(states(tasks)).toEqual([DOWNLOADING, DOWNLOADING, PENDING]);
  expect(background.requests.map(request => request.url)).toEqual([page(1), page(2)]);
});

test('a finished task frees its slot, and the next queued task starts', async () => {
  manager.setMaxDownloadingTasks(1);
  const tasks = await addTasks(1, 2);

  background.request(page(1)).complete();
  await vi.waitFor(() => expect(tasks[0].isComplete()).toBe(true));
  await browser._fake.flush();

  expect(states(tasks)).toEqual([COMPLETE, DOWNLOADING]);
  expect(background.request(page(2))).toBeDefined();
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    action: 'download:saveFile',
    args: expect.objectContaining({ filename: '1.zip' })
  }));
});

test('a task downloads every page, one at a time, before saving its zip', async () => {
  const task = createTask(1, 3);
  await manager.addTask(task);

  for (const p of [0, 1, 2]) {
    await vi.waitFor(() => expect(background.request(page(1, p))).toBeDefined());
    await browser._fake.flush();
    expect(background.requests).toHaveLength(p + 1);
    background.request(page(1, p)).complete();
  }
  await vi.waitFor(() => expect(task.isComplete()).toBe(true));

  expect(background.requests.map(request => request.url)).toEqual([page(1, 0), page(1, 1), page(1, 2)]);
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    action: 'download:saveFile',
    args: expect.objectContaining({ filename: '1.zip' })
  }));
});

test('a task whose page fails ends in failure, saves nothing, and frees its slot', async () => {
  manager.setMaxDownloadingTasks(1);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const tasks = await addTasks(1, 2);

  background.request(page(1)).fail('HTTP 404');
  await vi.waitFor(() => expect(tasks[0].isFailure()).toBe(true));
  await browser._fake.flush();

  expect(states(tasks)).toEqual([FAILURE, DOWNLOADING]);
  expect(tasks[0].lastError).toEqual(new Error('HTTP 404'));
  expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'download:saveFile' }));
});

test('raising the limit starts queued tasks at once; lowering it leaves running ones alone', async () => {
  manager.setMaxDownloadingTasks(1);
  const tasks = await addTasks(1, 2, 3);

  manager.setMaxDownloadingTasks(3);
  expect(states(tasks)).toEqual([DOWNLOADING, DOWNLOADING, DOWNLOADING]);

  manager.setMaxDownloadingTasks(1);
  expect(states(tasks)).toEqual([DOWNLOADING, DOWNLOADING, DOWNLOADING]);
  expect(manager.reachDownloadingTasksLimit()).toBe(true);
});

test.each([
  [0, 1],
  [-5, 1],
  [2, 2],
  ['2', 2],
  [9, 3],
  [NaN, 1],
  [null, 1],
  [undefined, 1]
])('setMaxDownloadingTasks(%s) keeps the limit within 1..3, at %i', (requested, expected) => {
  manager.setMaxDownloadingTasks(requested);

  expect(manager.maxDownloadingTasks).toBe(expected);
});

test('adding a task whose id is already managed is rejected', async () => {
  await addTasks(1);

  await expect(manager.addTask(createTask(1))).rejects.toMatchObject({ name: 'DownloadTaskExistsError' });
  expect(manager.getAllTasks().size).toBe(1);
});

test('getTask throws for an id it does not manage', () => {
  expect(() => manager.getTask('pixiv_illust:404')).toThrow(expect.objectContaining({ name: 'DownloadTaskNotFoundError' }));
});

test('pausing a download aborts its file in the background', async () => {
  const [task] = await addTasks(1);

  await manager.pauseTask(task.id);
  await browser._fake.flush();

  expect(task.isPaused()).toBe(true);
  expect(background.aborted).toEqual([page(1)]);
});

test('pausing aborts only the page in flight, not the ones already downloaded', async () => {
  window.$app.settings.downloadTasksWhenDownloadingImages = 3;
  const task = createTask(1, 2);
  await manager.addTask(task);
  await browser._fake.flush();
  background.request(page(1, 0)).complete();
  await vi.waitFor(() => expect(background.request(page(1, 1))).toBeDefined());

  await manager.pauseTask(task.id);
  await browser._fake.flush();

  expect(background.aborted).toEqual([page(1, 1)]);
});

test('starting a task that is already downloading is reported as an error, not a restart', async () => {
  const [task] = await addTasks(1);
  const onError = vi.fn();
  manager.addListener('error', onError);

  await manager.startTask(task.id);

  expect(manager.lastError).toMatchObject({ name: 'RuntimeError' });
  expect(onError).toHaveBeenCalledWith(manager.lastError);
  expect(background.requests).toHaveLength(1);
});

test('stopping a task aborts its file without changing its state', async () => {
  const [task] = await addTasks(1);

  await manager.stopTask(task.id);
  await browser._fake.flush();

  expect(background.aborted).toEqual([page(1)]);
  expect(task.isDownloading()).toBe(true);
});

test('deleting a downloading task frees its slot for the next queued one', async () => {
  manager.setMaxDownloadingTasks(1);
  const tasks = await addTasks(1, 2);

  await manager.deleteTask(tasks[0].id);
  await browser._fake.flush();

  expect(tasks[1].isDownloading()).toBe(true);
  expect(background.request(page(2))).toBeDefined();
});

test('deleting a task stops it, marks it deleted and forgets it, changes included', async () => {
  const [task] = await addTasks(1, 2);
  expect(manager.changedTaskIds).toContain(task.id);

  await manager.deleteTask(task.id);
  await browser._fake.flush();

  expect(task.isDelete).toBe(true);
  expect(background.aborted).toEqual([page(1)]);
  expect(() => manager.getTask(task.id)).toThrow(expect.objectContaining({ name: 'DownloadTaskNotFoundError' }));
  expect(manager.changedTaskIds).not.toContain(task.id);
});

test('flushChangedTasks returns only the tasks that changed since the last flush, then starts over', async () => {
  manager.setMaxDownloadingTasks(1);
  const tasks = await addTasks(1, 2);

  expect(manager.flushChangedTasks().map(json => json.id)).toEqual([tasks[0].id]);
  expect(manager.flushChangedTasks()).toEqual([]);

  background.request(page(1)).complete();
  await vi.waitFor(() => expect(tasks[0].isComplete()).toBe(true));

  const flushed = manager.flushChangedTasks();
  expect(flushed.map(json => json.id)).toEqual([tasks[0].id, tasks[1].id]);
  expect(flushed[0]).toMatchObject({ state: COMPLETE, title: 'Work 1' });
});

test('every change is announced with the ids changed so far', async () => {
  const onUpdate = vi.fn();
  manager.addListener('update', onUpdate);

  await addTasks(1, 2);

  expect(onUpdate).toHaveBeenLastCalledWith(['pixiv_illust:1', 'pixiv_illust:2']);
});

test('getAvaliableTasksJson lists every task not marked deleted', async () => {
  const tasks = await addTasks(1, 2);
  tasks[1].markDelete();

  expect(manager.getAvaliableTasksJson().map(json => json.id)).toEqual([tasks[0].id]);
});

describe('a novel task', () => {
  let releaseSave;
  let novelSaves;

  const createNovel = () => NovelDownloadTask.create({
    id: 'pixiv:illust:9',
    url: 'https://www.pixiv.net/novel/show.php?id=9',
    renameRule: '{id}',
    includeDescription: false,
    context: { id: '9', title: 'Novel 9', userName: 'Author', sections: ['text'] }
  });

  beforeEach(() => {
    novelSaves = 0;
    // Hold the novel's save until the spec releases it.
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'download:saveFile' && message.args.filename.endsWith('.txt')) {
        novelSaves++;
        releaseSave = () => sendResponse(99);
        return true;
      }
    });
  });

  test('holds a slot while it saves, then starts the next queued task', async () => {
    manager.setMaxDownloadingTasks(1);
    const novel = createNovel();
    await manager.addTask(novel);
    const [queued] = await addTasks(1);

    expect(states([novel, queued])).toEqual([DOWNLOADING, PENDING]);

    releaseSave();
    await vi.waitFor(() => expect(novel.isComplete()).toBe(true));

    expect(queued.isDownloading()).toBe(true);
  });

  test('is not started again when another task finishing restarts the queue', async () => {
    manager.setMaxDownloadingTasks(2);
    const [other] = await addTasks(1);
    const novel = createNovel();
    await manager.addTask(novel);

    background.request(page(1)).complete();
    await vi.waitFor(() => expect(other.isComplete()).toBe(true));
    releaseSave();
    await vi.waitFor(() => expect(novel.isComplete()).toBe(true));

    expect(novelSaves).toBe(1);
  });
});

describe('a failed task reports why', () => {
  test('its JSON carries the error message, and survives structured clone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const [task] = await addTasks(1);
    expect(manager.flushChangedTasks()[0].error).toBeNull();

    background.request(page(1)).fail('HTTP 404');
    await vi.waitFor(() => expect(task.isFailure()).toBe(true));
    const [json] = manager.flushChangedTasks();

    expect(json).toMatchObject({ state: FAILURE, error: 'HTTP 404' });
    expect(structuredClone(json)).toEqual(json);
  });

  test('an error that is a plain string is sent as is', () => {
    const task = createTask(1);
    task.lastError = 'Could not save';

    expect(task.toJson().error).toBe('Could not save');
  });
});

describe('retry and resume', () => {
  const PAUSED = 3;

  test('starting a failed task retries it, and it completes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const [task] = await addTasks(1);
    background.request(page(1)).fail('HTTP 500');
    await vi.waitFor(() => expect(task.isFailure()).toBe(true));

    await manager.startTask(task.id);
    expect(task.isDownloading()).toBe(true);
    await vi.waitFor(() => expect(background.requests).toHaveLength(2));
    background.request(page(1)).complete();
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(manager.lastError).toBeNull();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: 'download:saveFile',
      args: expect.objectContaining({ filename: '1.zip' })
    }));
  });

  test('starting a paused task resumes it from the page it was on', async () => {
    const task = createTask(1, 2);
    await manager.addTask(task);
    await browser._fake.flush();
    background.request(page(1, 0)).complete();
    await vi.waitFor(() => expect(background.request(page(1, 1))).toBeDefined());

    await manager.pauseTask(task.id);
    await browser._fake.flush();
    expect(task.state).toBe(PAUSED);

    await manager.startTask(task.id);
    expect(task.isDownloading()).toBe(true);
    await vi.waitFor(() => expect(background.requests).toHaveLength(3));
    expect(background.requests.map(request => request.url)).toEqual([page(1, 0), page(1, 1), page(1, 1)]);

    background.request(page(1, 1)).complete();
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));
    expect(manager.lastError).toBeNull();
  });

  test('pausing and resuming before the abort comes back restarts the page and completes once', async () => {
    const [task] = await addTasks(1);
    const onComplete = vi.fn();
    task.addListener('complete', onComplete);

    // No await between them, so the resume lands before the abort reply.
    manager.pauseTask(task.id);
    manager.startTask(task.id);
    expect(task.isDownloading()).toBe(true);

    await vi.waitFor(() => expect(background.requests).toHaveLength(2));
    background.request(page(1)).complete();
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));
    await browser._fake.flush();

    expect(background.aborted).toEqual([page(1)]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(manager.lastError).toBeNull();
  });

  test('startAll resumes paused and failed tasks up to the limit, and leaves the rest alone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    manager.setMaxDownloadingTasks(3);
    const tasks = await addTasks(1, 2, 3, 4);
    background.request(page(1)).fail('HTTP 500');
    await vi.waitFor(() => expect(tasks[0].isFailure()).toBe(true));
    await browser._fake.flush();
    // Task 4 took the failed task's slot.
    expect(states(tasks)).toEqual([FAILURE, DOWNLOADING, DOWNLOADING, DOWNLOADING]);
    await manager.pauseTask(tasks[1].id);
    await manager.pauseTask(tasks[2].id);
    await browser._fake.flush();
    background.request(page(4)).complete();
    await vi.waitFor(() => expect(tasks[3].isComplete()).toBe(true));
    manager.setMaxDownloadingTasks(2);

    expect(() => manager.startAll()).not.toThrow();

    expect(states(tasks)).toEqual([DOWNLOADING, DOWNLOADING, PENDING, COMPLETE]);
    expect(manager.lastError).toBeNull();
    await browser._fake.flush();
    expect(background.requests.map(request => request.url)).toEqual([page(1), page(2), page(3), page(4), page(1), page(2)]);
  });

  test('a page that completes before its abort comes back pauses the task, and resuming saves without fetching it again', async () => {
    const [task] = await addTasks(1);
    const onComplete = vi.fn();
    task.addListener('complete', onComplete);

    // The abort is on its way when the page completes; the fake background still answers it.
    manager.pauseTask(task.id);
    background.request(page(1)).complete();
    await vi.waitFor(() => expect(task.downloader.successCount).toBe(1));
    await browser._fake.flush();
    expect(task.state).toBe(PAUSED);

    await manager.startTask(task.id);
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(background.requests).toHaveLength(1);
    expect(task.downloader.successCount).toBe(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(browser.runtime.sendMessage.mock.calls.filter(([message]) => message.action === 'download:saveFile')).toHaveLength(1);
  });

  test('startAll with nothing to resume does nothing', async () => {
    const tasks = await addTasks(1);

    expect(() => manager.startAll()).not.toThrow();
    expect(states(tasks)).toEqual([DOWNLOADING]);
    expect(manager.lastError).toBeNull();
  });
});
