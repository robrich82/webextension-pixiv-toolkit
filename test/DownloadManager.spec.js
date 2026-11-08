/**
 * DownloadManager driving real MultiplePagesDownloadTasks. The network's only
 * stand-in is the background's end of each `DownloadFile` port
 * (fakeDownloadFileBackground), so a spec decides when each file finishes.
 */
import browser from './doubles/browser';
import { fakeDownloadFileBackground } from './helpers/downloadFileBackground';
import DownloadManager from '@/options_page/modules/DownloadManager';
import MultiplePagesDownloadTask from '@/options_page/modules/DownloadTasks/MultiplePagesDownloadTask';

let background;
let manager;

const page = n => `https://i.pximg.net/img/${n}_p0.png`;

const createTask = n => new MultiplePagesDownloadTask({
  id: `pixiv_illust:${n}`,
  url: `https://www.pixiv.net/artworks/${n}`,
  pages: [page(n)],
  selectedIndexes: [],
  pageNumberStartWithOne: 1,
  pageNumberLength: -1,
  renameRule: '{id}',
  renameImageRule: 'p{pageNum}',
  context: { id: `${n}`, title: `Work ${n}`, totalPages: 1 }
});

const addTasks = async (...ns) => {
  const tasks = ns.map(createTask);

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
      downloadTasksWhenDownloadingImages: 3, // the default; 1 hits Downloader.removeDownloadFromCollection's splice bug
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
