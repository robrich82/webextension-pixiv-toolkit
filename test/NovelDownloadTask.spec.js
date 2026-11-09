/**
 * NovelDownloadTask builds the book in the page and saves it through the
 * background's `download:saveFile`. The epub specs run the vendored EpubMaker
 * with the globals downloads.html loads; only its cover fetch is stubbed.
 */
import JSZip from '../src/statics/lib/jszip/jszip.js';
import Handlebars from '../src/statics/lib/handlebars-latest.js';
import browser from './doubles/browser';
import NovelDownloadTask from '@/options_page/modules/DownloadTasks/Pixiv/NovelDownloadTask';

let saved;
let saveResponse;
let coverError;

const createTask = options => NovelDownloadTask.create({
  id: 'pixiv:illust:555',
  url: 'https://www.pixiv.net/novel/show.php?id=555',
  renameRule: '{id}_{title}',
  includeDescription: false,
  context: {
    id: '555',
    title: 'A Novel',
    userName: 'Author',
    url: 'https://www.pixiv.net/novel/show.php?id=555',
    coverUrl: 'https://i.pximg.net/c/cover.jpg',
    description: 'About<br />it',
    sections: ['First<br />page ', 'Second page']
  },
  ...options
});

const events = task => {
  const fired = [];

  for (const name of ['start', 'complete', 'failure']) {
    task.addListener(name, () => fired.push([name, task.state]));
  }

  return fired;
};

const epubFiles = async blob => {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const text = name => zip.file(name).async('string');

  return { names: Object.keys(zip.files), text };
};

beforeAll(async () => {
  globalThis.JSZip = JSZip;
  globalThis.Handlebars = Handlebars;
  globalThis.JSZipUtils = {
    getBinaryContent: (url, callback) => (coverError ? callback(coverError) : callback(null, new Uint8Array([1, 2, 3])))
  };
  // Silence its debug output, as the spies below are restored after every test.
  const { log, info, debug } = console;
  console.log = console.info = console.debug = () => {};
  // Sets window.EpubMaker (window is globalThis here), as it does on the page.
  await import('../src/statics/lib/js-epub-maker/js-epub-maker.js');
  Object.assign(console, { log, info, debug });
});

afterAll(() => {
  delete globalThis.JSZip;
  delete globalThis.Handlebars;
  delete globalThis.JSZipUtils;
  delete globalThis.EpubMaker;
});

beforeEach(() => {
  window.$app = { settings: { downloadRelativeLocation: 'novels' } };
  saved = [];
  saveResponse = () => saved.length;
  coverError = null;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});

  // Read each saved blob while its object url is still alive.
  const createObjectURL = URL.createObjectURL;
  const blobs = new Map();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    const url = createObjectURL(blob);
    blobs.set(url, blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL');
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.to === 'ws' && message.action === 'download:saveFile') {
      const { url, filename } = message.args;
      saved.push({ url, filename, blob: blobs.get(url) });
      sendResponse(saveResponse());
      return true;
    }
  });
});

afterEach(() => {
  delete window.$app;
  vi.restoreAllMocks();
});

test('saves the novel as text, one part per paragraph block, under the rename rule', async () => {
  const task = createTask();
  const fired = events(task);

  await task.start();

  expect(saved.map(file => file.filename)).toEqual(['novels/555_A Novel.txt']);
  expect(await saved[0].blob.text()).toBe([
    'https://www.pixiv.net/novel/show.php?id=555',
    'Author',
    'A Novel',
    'First\r\npage',
    'Second page'
  ].join('\r\n\r\n'));
  expect(saved[0].blob.type).toBe('text/plain');
  expect(fired).toEqual([['start', task.DOWNLOADING_STATE], ['complete', task.COMPLETE_STATE]]);
  expect(task.toJson()).toMatchObject({ type: 'PIXIV_NOVEL', state: task.COMPLETE_STATE, progress: 1, downloadId: 1 });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(saved[0].url);
});

test('puts the description after the title when asked to', async () => {
  const task = createTask({ includeDescription: true });

  await task.start();

  expect((await saved[0].blob.text()).split('\r\n\r\n')[3]).toBe('About\r\nit');
});

test('falls back to id_title when the rename rule is empty', async () => {
  const task = createTask({ renameRule: '' });

  await task.start();

  expect(saved.map(file => file.filename)).toEqual(['novels/555_A Novel.txt']);
});

test('saves an epub with the cover, the description and the sections', async () => {
  const task = createTask({ bookType: 'epub', includeDescription: true });
  const fired = events(task);

  await task.start();

  expect(saved.map(file => file.filename)).toEqual(['novels/555_A Novel.epub']);
  expect(saved[0].blob.type).toBe('application/epub+zip');
  const epub = await epubFiles(saved[0].blob);
  expect(epub.names).toContain('EPUB/a novel-cover.jpg');
  expect(await epub.text('EPUB/a novel.opf')).toContain('<dc:creator>Author</dc:creator>');
  const content = await epub.text('EPUB/a novel-content.xhtml');
  expect(content.indexOf('About')).toBeLessThan(content.indexOf('First'));
  expect(content).toContain('Second page');
  expect(fired).toEqual([['start', task.DOWNLOADING_STATE], ['complete', task.COMPLETE_STATE]]);
});

test('an epub whose cover cannot be fetched fails the task, and nothing is saved', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  coverError = new Error('HTTP 403');
  const task = createTask({ bookType: 'epub' });
  const fired = events(task);

  await task.start();

  expect(task.isFailure()).toBe(true);
  expect(task.lastError).toBe(coverError);
  expect(saved).toEqual([]);
  expect(fired).toEqual([['start', task.DOWNLOADING_STATE], ['failure', task.FAILURE_STATE]]);
  expect(console.error).toHaveBeenCalledWith('Could not save novel pixiv:illust:555', coverError);
});

test('a save the background could not make fails the task', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // Application.onMessage answers a failed handler with undefined.
  saveResponse = () => undefined;
  const task = createTask();

  await task.start();

  expect(task.isFailure()).toBe(true);
  expect(task.lastError).toEqual(new Error('Could not save txt book'));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(saved[0].url);
});

test('start while the book is being saved does not save it twice', async () => {
  const task = createTask();

  await Promise.all([task.start(), task.start()]);
  await task.start();

  expect(saved).toHaveLength(1);
  expect(task.isComplete()).toBe(true);
});

test('pause and stop leave a running book alone', async () => {
  const task = createTask();
  const running = task.start();

  task.pause();
  task.stop();
  await running;

  expect(task.isComplete()).toBe(true);
  expect(saved).toHaveLength(1);
});
