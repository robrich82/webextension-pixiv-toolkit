// @vitest-environment jsdom
/**
 * Downloader against the real background end of its `DownloadFile` ports:
 * Application.onConnect → DownloadFileService → Download. The only stand-in is
 * the network under `fetch` (installFileServer). jsdom, because the background
 * reads each finished file with FileReader.
 */
import browser from './doubles/browser';
import { installFileServer } from './helpers/fileServer';
import Application from '@/background/Application';
import Downloader from '@/modules/Net/Downloader';

let server;
let downloader;
let events;

const file = n => `https://i.pximg.net/img/${n}.png`;

const createDownloader = (ns, options = {}) => {
  downloader = new Downloader({ processors: 1, ...options });
  ns.forEach(n => downloader.appendFile(file(n), { n }));

  events = [];
  ['start', 'progress', 'item-finish', 'item-error', 'finish', 'failure', 'pause'].forEach(name => {
    downloader.addListener(name, (...args) => events.push([name, ...args]));
  });

  return downloader;
};

const nextEvent = name => new Promise(resolve => downloader.addListener(name, (...args) => resolve(args)));

const named = name => events.filter(([eventName]) => eventName === name).map(([, payload]) => payload);

const lastProgress = () => named('progress').pop();

/** The `index`th request to reach the network, once it has. */
const nthRequest = index => vi.waitFor(() => {
  expect(server.requests.length).toBeGreaterThan(index);
  return server.requests[index];
}, { interval: 1 });

const requestedUrls = () => server.requests.map(request => request.url);

beforeEach(() => {
  Application.instance = undefined;
  const app = Application.createApp();
  browser.runtime.onConnect.addListener(port => app.onConnect(port));

  server = installFileServer();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  server.uninstall();
  vi.restoreAllMocks();
});

test('downloads its files one at a time, handing each over with its args and type, then finishes', async () => {
  createDownloader([1, 2]);
  const finished = nextEvent('finish');

  downloader.download();
  const first = await nthRequest(0);
  await browser._fake.flush();
  expect(requestedUrls()).toEqual([file(1)]);

  first.respond('one', { type: 'image/png' });
  (await nthRequest(1)).respond('two', { type: 'image/jpeg' });
  await finished;

  const items = named('item-finish');
  expect(await Promise.all(items.map(item => item.blob.text()))).toEqual(['one', 'two']);
  expect(items.map(item => [item.args, item.mimeType])).toEqual([[{ n: 1 }, 'image/png'], [{ n: 2 }, 'image/jpeg']]);
  expect(requestedUrls()).toEqual([file(1), file(2)]);
  expect(named('failure')).toHaveLength(0);
});

test('reports progress across all files as each body arrives, and 0 for a body of unknown length', async () => {
  createDownloader([1, 2]);
  const finished = nextEvent('finish');

  downloader.download();
  const first = await nthRequest(0);
  first.respond('abcd', { stall: true });
  await vi.waitFor(() => expect(lastProgress()).toEqual({ progress: 0.25, successCount: 0, failCount: 0 }), { interval: 1 });

  first.finish();
  (await nthRequest(1)).respond('xyz', { contentLength: false });
  await finished;

  expect(named('progress')).toEqual([
    { progress: 0.25, successCount: 0, failCount: 0 },
    { progress: 0.5, successCount: 0, failCount: 0 },
    { progress: 0.5, successCount: 1, failCount: 0 },
    { progress: 0.5, successCount: 1, failCount: 0 }
  ]);
});

test('a file that fails is reported and set aside, the rest still download, and the run ends in failure', async () => {
  createDownloader([1, 2]);
  const failed = nextEvent('failure');

  downloader.download();
  (await nthRequest(0)).fail();
  (await nthRequest(1)).respond('two');
  await failed;

  expect(named('item-error')).toEqual([new Error('Failed to fetch')]);
  expect(named('item-finish').map(item => item.args)).toEqual([{ n: 2 }]);
  expect(named('finish')).toHaveLength(0);
  expect(downloader.failedDownloadFiles.map(downloadFile => downloadFile.file)).toEqual([file(1)]);
});

test('downloading again retries only the files that failed', async () => {
  createDownloader([1, 2]);
  const failed = nextEvent('failure');
  downloader.download();
  (await nthRequest(0)).fail();
  (await nthRequest(1)).respond('two');
  await failed;

  const finished = nextEvent('finish');
  downloader.download();
  (await nthRequest(2)).respond('one');
  await finished;

  expect(requestedUrls()).toEqual([file(1), file(2), file(1)]);
  expect(lastProgress()).toEqual({ progress: 1, successCount: 1, failCount: 0 });
  expect(downloader.successCount).toBe(2);
});

test('an HTTP error status fails the file instead of saving the error page', async () => {
  createDownloader([1]);
  const failed = nextEvent('failure');

  downloader.download();
  (await nthRequest(0)).respond('Forbidden', { status: 403, type: 'text/html' });
  await failed;

  expect(named('item-error')).toEqual([new Error('HTTP 403')]);
  expect(named('item-finish')).toHaveLength(0);
});

test('a file whose afterItemDownload rejects counts as failed', async () => {
  createDownloader([1], { afterItemDownload: () => Promise.reject(new Error('could not decrypt')) });
  const failed = nextEvent('failure');

  downloader.download();
  (await nthRequest(0)).respond('one');
  await failed;

  expect(named('item-error')).toEqual([new Error('could not decrypt')]);
  expect(named('item-finish')).toHaveLength(0);
  expect(downloader.successCount).toBe(0);
});

test('pausing aborts the file in flight and puts it back; downloading again restarts it', async () => {
  createDownloader([1, 2]);
  downloader.download();
  const first = await nthRequest(0);
  first.respond('abcd', { stall: true });
  await vi.waitFor(() => expect(lastProgress().progress).toBe(0.25), { interval: 1 });

  const paused = nextEvent('pause');
  downloader.pause();
  await paused;

  expect(first.aborted).toBe(true);
  expect(named('item-error')).toHaveLength(0);
  expect(downloader.downloadFiles.map(downloadFile => downloadFile.file)).toEqual([file(1), file(2)]);

  const finished = nextEvent('finish');
  downloader.download();
  (await nthRequest(1)).respond('one');
  (await nthRequest(2)).respond('two');
  await finished;

  expect(requestedUrls()).toEqual([file(1), file(1), file(2)]);
  expect(named('item-finish').map(item => item.args)).toEqual([{ n: 1 }, { n: 2 }]);
});

test('pausing before the server answers is a pause too, not a failed file', async () => {
  createDownloader([1]);
  downloader.download();
  const first = await nthRequest(0);

  const paused = nextEvent('pause');
  downloader.pause();
  await paused;

  expect(first.aborted).toBe(true);
  expect(named('item-error')).toHaveLength(0);
  expect(downloader.failedDownloadFiles).toHaveLength(0);
});

test('downloading again before the abort comes back still downloads the file, instead of finishing empty', async () => {
  createDownloader([1]);
  downloader.download();
  const first = await nthRequest(0);
  first.respond('abcd', { stall: true });
  await vi.waitFor(() => expect(lastProgress().progress).toBe(0.5), { interval: 1 });

  const finished = nextEvent('finish');
  downloader.pause();
  downloader.download();
  expect(named('finish')).toHaveLength(0);

  (await nthRequest(1)).respond('one');
  await finished;

  expect(first.aborted).toBe(true);
  expect(named('item-finish').map(item => item.args)).toEqual([{ n: 1 }]);
  expect(named('pause')).toHaveLength(0);
});

test('reset after a pause starts every file over', async () => {
  createDownloader([1, 2]);
  downloader.download();
  (await nthRequest(0)).respond('one');
  const second = await nthRequest(1);
  second.respond('abcd', { stall: true });
  await vi.waitFor(() => expect(lastProgress().progress).toBe(0.75), { interval: 1 });

  const paused = nextEvent('pause');
  downloader.pause();
  await paused;

  downloader.reset();
  const finished = nextEvent('finish');
  downloader.download();
  (await nthRequest(2)).respond('one');
  (await nthRequest(3)).respond('two');
  await finished;

  expect(requestedUrls()).toEqual([file(1), file(2), file(1), file(2)]);
  expect(downloader.files).toHaveLength(2);
  expect(downloader.successCount).toBe(2);
  expect(lastProgress().progress).toBe(1);
});
