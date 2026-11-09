/**
 * EpisodeDownloadTask driving a real Downloader. The background's end of each
 * `DownloadFile` port is the network stand-in, and `decrypteImage` (a canvas
 * job, which node lacks) is stubbed.
 */
import browser from './doubles/browser';
import { fakeDownloadFileBackground } from './helpers/downloadFileBackground';
import { decrypteImage } from '@/modules/Parser/PixivComic/ImageDecrypte';
import EpisodeDownloadTask from '@/options_page/modules/DownloadTasks/PixivComic/EpisodeDownloadTask';

vi.mock('@/modules/Parser/PixivComic/ImageDecrypte', () => ({
  decrypteImage: vi.fn()
}));

let background;
let zipped;

const pageUrl = p => `https://comic.pixiv.net/images/episode/${p}.jpg`;
const comicPage = p => ({ url: pageUrl(p), key: `key-${p}`, width: 2, height: 2, gridsize: 1 });

const createTask = ({ totalPages = 2, ...options } = {}) => EpisodeDownloadTask.create({
  id: 'pixiv_comic:episode:77',
  url: 'https://comic.pixiv.net/viewer/stories/77',
  pages: Array.from({ length: totalPages }, (_, p) => comicPage(p)),
  pageNumberStartWithOne: 1,
  pageNumberLength: -1,
  renameRule: '{id}_{title}',
  renameImageRule: 'p{pageNum}',
  context: { id: '77', title: 'Episode 1', totalPages },
  ...options
});

const settings = overrides => {
  window.$app = {
    settings: {
      downloadSaveMode: 0,
      globalZipMultipleImages: 1,
      downloadTasksWhenDownloadingImages: 1,
      downloadRelativeLocation: 'pixiv',
      ...overrides
    }
  };
};

/** Answers each page in turn, as the task asks for it. */
const completePages = async (...ps) => {
  for (const p of ps) {
    await vi.waitFor(() => expect(background.request(pageUrl(p))).toBeDefined());
    background.request(pageUrl(p)).complete(`encrypted ${p}`, 'image/jpeg');
  }
};

const savedFilenames = () => browser.runtime.sendMessage.mock.calls
  .map(([message]) => message)
  .filter(message => message.action === 'download:saveFile')
  .map(message => message.args.filename);

beforeEach(() => {
  settings();
  zipped = [];
  globalThis.JSZip = class FakeJSZip {
    file(name, blob) {
      zipped.push({ name, blob });
    }

    generateAsync() {
      return Promise.resolve(new Blob(['zip']));
    }
  };
  vi.mocked(decrypteImage).mockReset();
  vi.mocked(decrypteImage).mockImplementation(async (page, blob) =>
    new Blob([`decrypted ${await blob.text()}`], { type: 'image/png' }));
  background = fakeDownloadFileBackground();
});

afterEach(() => {
  delete window.$app;
  delete globalThis.JSZip;
  vi.restoreAllMocks();
});

test('fetches each page with its gridshuffle key, decrypts it, and zips it, named for its decrypted type', async () => {
  const task = createTask();
  const completed = vi.fn();
  task.addListener('complete', completed);

  task.start();
  expect(task.isDownloading()).toBe(true);
  await completePages(0, 1);
  await vi.waitFor(() => expect(task.isComplete()).toBe(true));

  expect(background.requests.map(request => request.options.headers)).toEqual([
    { 'x-cobalt-thumber-parameter-gridshuffle-key': 'key-0' },
    { 'x-cobalt-thumber-parameter-gridshuffle-key': 'key-1' }
  ]);
  expect(vi.mocked(decrypteImage).mock.calls.map(([page, , returnType]) => [page.key, returnType]))
    .toEqual([['key-0', 'blob'], ['key-1', 'blob']]);
  expect(zipped.map(entry => entry.name)).toEqual(['p1.png', 'p2.png']);
  expect(await zipped[0].blob.text()).toBe('decrypted encrypted 0');
  expect(savedFilenames()).toEqual(['pixiv/77_Episode 1.zip']);
  expect(completed).toHaveBeenCalledTimes(1);
  expect(task.toJson()).toMatchObject({ type: 'PIXIV_COMIC_EPISODE', state: task.COMPLETE_STATE, progress: 1 });
});

test('downloads only the selected pages, numbered by their place in the episode', async () => {
  const task = createTask({ totalPages: 12, selectedIndexes: [10, 2] });

  task.start();
  await completePages(2, 10);
  await vi.waitFor(() => expect(task.isComplete()).toBe(true));

  expect(background.requests.map(request => request.url)).toEqual([pageUrl(2), pageUrl(10)]);
  expect(zipped.map(entry => entry.name)).toEqual(['p03.png', 'p11.png']);
});

test.each([
  [{ pageNumberStartWithOne: 0, pageNumberLength: 0 }, ['p0.png', 'p1.png']],
  [{ pageNumberStartWithOne: 1, pageNumberLength: 3 }, ['p001.png', 'p002.png']],
  [{ pageNumberStartWithOne: 0, pageNumberLength: -1 }, ['p0.png', 'p1.png']]
])('page numbers follow %o', async (options, names) => {
  const task = createTask(options);

  task.start();
  await completePages(0, 1);
  await vi.waitFor(() => expect(task.isComplete()).toBe(true));

  expect(zipped.map(entry => entry.name)).toEqual(names);
});

test('saves each page into a work folder when zipping is off', async () => {
  settings({ globalZipMultipleImages: 0 });
  const task = createTask();

  task.start();
  await completePages(0, 1);
  await vi.waitFor(() => expect(savedFilenames()).toHaveLength(2));

  expect(savedFilenames()).toEqual(['pixiv/77_Episode 1/p1.png', 'pixiv/77_Episode 1/p2.png']);
  expect(zipped).toEqual([]);
});

test('a page saved to a work folder keeps its blob url until its download finishes (#296)', async () => {
  settings({ globalZipMultipleImages: 0 });
  const saves = background.saves;
  vi.spyOn(URL, 'revokeObjectURL');
  const task = createTask({ totalPages: 1 });

  task.start();
  await completePages(0);
  await vi.waitFor(() => expect(saves).toHaveLength(1));
  await browser._fake.flush();

  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(saves[0].url);
  browser._fake.finishDownload(saves[0].downloadId);
  await browser._fake.flush();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(saves[0].url);
});

test('a page that fails to download fails the task, and nothing is saved', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const task = createTask();
  const failed = vi.fn();
  task.addListener('failure', failed);

  task.start();
  await completePages(0);
  await vi.waitFor(() => expect(background.request(pageUrl(1))).toBeDefined());
  background.request(pageUrl(1)).fail('HTTP 404');
  await vi.waitFor(() => expect(task.isFailure()).toBe(true));

  expect(task.lastError).toEqual(new Error('HTTP 404'));
  expect(failed).toHaveBeenCalledTimes(1);
  expect(savedFilenames()).toEqual([]);
});

test('a page that fails to decrypt fails the task instead of hanging it', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(decrypteImage).mockRejectedValueOnce(new Error("Couldn't load the encrypted image"));
  const task = createTask();

  task.start();
  await completePages(0, 1);
  await vi.waitFor(() => expect(task.isFailure()).toBe(true));

  expect(task.lastError).toEqual(new Error("Couldn't load the encrypted image"));
  expect(zipped.map(entry => entry.name)).toEqual(['p2.png']);
  expect(savedFilenames()).toEqual([]);
});

test('pause aborts the page in flight, and start(true) downloads the episode again', async () => {
  const task = createTask();

  task.start();
  await vi.waitFor(() => expect(background.request(pageUrl(0))).toBeDefined());
  task.pause();
  await browser._fake.flush();

  expect(task.isPaused()).toBe(true);
  expect(background.aborted).toEqual([pageUrl(0)]);

  task.tryPending();
  task.start(true);
  await vi.waitFor(() => expect(background.requests).toHaveLength(2));
  await completePages(0, 1);
  await vi.waitFor(() => expect(task.isComplete()).toBe(true));

  expect(zipped.map(entry => entry.name)).toEqual(['p1.png', 'p2.png']);
});

test('stop aborts the page in flight', async () => {
  const task = createTask();

  task.start();
  await vi.waitFor(() => expect(background.request(pageUrl(0))).toBeDefined());
  task.stop();
  await browser._fake.flush();

  expect(background.aborted).toEqual([pageUrl(0)]);
});

test('start does nothing unless the task is pending', async () => {
  const task = createTask();
  task.changeState(task.COMPLETE_STATE);

  task.start();
  await browser._fake.flush();

  expect(background.requests).toEqual([]);
});

describe('a save that fails fails the task', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('the episode zip', async () => {
    background.failSaves(() => true);
    const task = createTask();

    task.start();
    await completePages(0, 1);
    await vi.waitFor(() => expect(task.isFailure()).toBe(true));

    expect(task.lastError).toEqual(new Error('Could not save "pixiv/77_Episode 1.zip"'));
  });

  test('a page saved on its own', async () => {
    settings({ globalZipMultipleImages: 0 });
    background.failSaves(save => save.filename.endsWith('p1.png'));
    const task = createTask();

    task.start();
    await completePages(0, 1);
    await vi.waitFor(() => expect(task.isFailure()).toBe(true));

    expect(task.lastError).toEqual(new Error('Could not save "pixiv/77_Episode 1/p1.png"'));
  });
});
