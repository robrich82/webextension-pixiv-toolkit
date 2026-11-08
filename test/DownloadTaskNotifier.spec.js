/**
 * The download manager page's DownloadTaskNotifier, talking to the content
 * script's real DownloadTaskObserver over the browser fake's ports.
 */
import browser from './doubles/browser';
import DownloadTaskObserver from '@/content_scripts/modules/DownloadTaskObserver';
import DownloadManager from '@/options_page/modules/DownloadManager';
import DownloadTaskNotifier from '@/options_page/modules/DownloadTaskNotifier';
import AbstractDownloadTask from '@/options_page/modules/DownloadTasks/AbstractDownloadTask';

let manager;
let notifier;

// Ports deliver on microtasks; timers are fake, so let both run.
const settle = () => vi.advanceTimersByTimeAsync(0);

const seedTask = (id, fields = {}) => {
  const task = Object.assign(new AbstractDownloadTask(), { id, url: `https://example.com/${id}`, title: id }, fields);

  manager.tasks.set(id, task);

  return task;
};

const observe = async ids => {
  const observer = new DownloadTaskObserver();
  const statuses = [];

  observer.addListener('status', message => statuses.push(message.downloadTasksStatus));
  observer.observeDownloadTasks(ids);
  await settle();

  return { observer, statuses };
};

const statusIds = status => status.map(task => task.id);

beforeEach(() => {
  vi.useFakeTimers();
  DownloadManager.defaultInstance = undefined;
  DownloadTaskNotifier.instance = undefined;
  manager = DownloadManager.getDefault();
  notifier = DownloadTaskNotifier.getDefault();
  notifier.initialize();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

test('getDefault hands back one shared notifier, bound to the default manager', () => {
  expect(DownloadTaskNotifier.getDefault()).toBe(notifier);
  expect(notifier.downloadManager).toBe(manager);
});

test('sends an observer the status of the tasks it asked about, skipping ids the manager does not know', async () => {
  seedTask('pixiv_illust:1', { progress: 0.5 });
  seedTask('pixiv_illust:2');

  const { statuses } = await observe(['pixiv_illust:1', 'pixiv_illust:404']);

  expect(statuses).toHaveLength(1);
  expect(statuses[0]).toEqual([expect.objectContaining({ id: 'pixiv_illust:1', progress: 0.5, state: 1 })]);
});

test('each observer gets only its own tasks', async () => {
  seedTask('pixiv_illust:1');
  seedTask('pixiv_novel:2');

  const first = await observe(['pixiv_illust:1']);
  const second = await observe(['pixiv_novel:2']);

  expect(statusIds(second.statuses.at(-1))).toEqual(['pixiv_novel:2']);
  // The second subscription notifies every port, the first one included.
  expect(first.statuses.map(statusIds)).toEqual([['pixiv_illust:1'], ['pixiv_illust:1']]);
});

test('sends nothing to an observer when none of its tasks exist', async () => {
  seedTask('pixiv_illust:1');

  const { statuses } = await observe(['pixiv_illust:404']);
  await vi.advanceTimersByTimeAsync(1200);

  expect(statuses).toEqual([]);
});

test('keeps resending the current status every 600ms', async () => {
  const task = seedTask('pixiv_illust:1');
  const { statuses } = await observe(['pixiv_illust:1']);

  task.progress = 0.75;
  await vi.advanceTimersByTimeAsync(599);
  expect(statuses).toHaveLength(1);

  await vi.advanceTimersByTimeAsync(1);
  expect(statuses).toHaveLength(2);
  expect(statuses[1][0].progress).toBe(0.75);
});

test('a new subscription restarts the timer rather than adding a second one', async () => {
  seedTask('pixiv_illust:1');
  const { statuses } = await observe(['pixiv_illust:1']);
  await observe(['pixiv_illust:1']);

  const before = statuses.length;
  await vi.advanceTimersByTimeAsync(600);

  expect(statuses.length - before).toBe(1);
});

test('forgets an observer once it disconnects', async () => {
  seedTask('pixiv_illust:1');
  const { observer, statuses } = await observe(['pixiv_illust:1']);
  expect(notifier.downloadTaskPorts.size).toBe(1);

  observer.stopObserve();
  await settle();
  await vi.advanceTimersByTimeAsync(1200);

  expect(notifier.downloadTaskPorts.size).toBe(0);
  expect(statuses).toHaveLength(1);
});

test('re-observing replaces the old port with a new one', async () => {
  seedTask('pixiv_illust:1');
  seedTask('pixiv_illust:2');
  const observer = new DownloadTaskObserver();
  const statuses = [];
  observer.addListener('status', message => statuses.push(statusIds(message.downloadTasksStatus)));

  observer.observeDownloadTasks(['pixiv_illust:1']);
  await settle();
  observer.observeDownloadTasks(['pixiv_illust:2']);
  await settle();
  await vi.advanceTimersByTimeAsync(600);

  expect(notifier.downloadTaskPorts.size).toBe(1);
  expect(statuses.at(-1)).toEqual(['pixiv_illust:2']);
});

test('ignores ports on other channels', async () => {
  browser.runtime.connect({ name: 'DownloadFile' });
  await settle();

  expect(notifier.downloadTaskPorts.size).toBe(0);
});

test('a message without task ids leaves the subscription as it was', async () => {
  seedTask('pixiv_illust:1');
  const { observer, statuses } = await observe(['pixiv_illust:1']);

  observer.port.postMessage({ args: {} });
  await settle();
  await vi.advanceTimersByTimeAsync(600);

  expect(statuses.map(statusIds).at(-1)).toEqual(['pixiv_illust:1']);
  expect(statuses).toHaveLength(2);
});
