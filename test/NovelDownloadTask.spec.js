/**
 * NovelDownloadTask builds the book in the page and saves it through the
 * background's `download:saveFile`. EpubMaker is a global script on the download
 * manager page, so the epub specs stand one in.
 */
import browser from './doubles/browser';
import NovelDownloadTask from '@/options_page/modules/DownloadTasks/Pixiv/NovelDownloadTask';

let saved;
let epubMakers;

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

class FakeEpubMaker {
  calls = [];
  sections = [];
  makeEpub = vi.fn(async () => new Blob(['epub'], { type: 'application/epub+zip' }));

  constructor() {
    epubMakers.push(this);

    for (const method of ['withTemplate', 'withUuid', 'withAuthor', 'withAttributionUrl', 'withCover', 'withTitle']) {
      this[method] = value => this.calls.push([method, value]);
    }
  }

  withSection(section) {
    this.sections.push(section.content.content);
  }

  static Section = class {
    constructor(epubType, id, content) {
      Object.assign(this, { epubType, id, content });
    }
  };
}

beforeEach(() => {
  window.$app = { settings: { downloadRelativeLocation: 'novels' } };
  saved = [];
  epubMakers = [];
  globalThis.EpubMaker = FakeEpubMaker;

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
      sendResponse(saved.length);
      return true;
    }
  });
});

afterEach(() => {
  delete window.$app;
  delete globalThis.EpubMaker;
  vi.restoreAllMocks();
});

const events = task => {
  const fired = [];

  for (const name of ['start', 'complete', 'failure']) {
    task.addListener(name, () => fired.push([name, task.state]));
  }

  return fired;
};

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

test('saves an epub with the metadata, description and sections', async () => {
  const task = createTask({ bookType: 'epub', includeDescription: true });
  const fired = events(task);

  await task.start();

  const [maker] = epubMakers;
  expect(maker.calls).toEqual([
    ['withTemplate', 'idpf-wasteland'],
    ['withUuid', 'https://www.pixiv.net/novel/show.php?id=555'],
    ['withAuthor', 'Author'],
    ['withAttributionUrl', 'https://www.pixiv.net/novel/show.php?id=555'],
    ['withCover', 'https://i.pximg.net/c/cover.jpg'],
    ['withTitle', 'A Novel']
  ]);
  expect(maker.sections).toEqual(['About<br />it', 'First<br />page ', 'Second page']);
  expect(saved.map(file => file.filename)).toEqual(['novels/555_A Novel.epub']);
  expect(saved[0].blob.type).toBe('application/epub+zip');
  expect(fired).toEqual([['start', task.DOWNLOADING_STATE], ['complete', task.COMPLETE_STATE]]);
});

test('an epub that fails to build fails the task, and nothing is saved', async () => {
  const task = createTask({ bookType: 'epub' });
  const fired = events(task);
  const error = new Error('cover request failed');
  globalThis.EpubMaker = class extends FakeEpubMaker {
    makeEpub = vi.fn(async () => {
      throw error;
    });
  };

  await task.start();

  expect(task.isFailure()).toBe(true);
  expect(task.lastError).toBe(error);
  expect(saved).toEqual([]);
  expect(fired).toEqual([['start', task.DOWNLOADING_STATE], ['failure', task.FAILURE_STATE]]);
});

test('a save the background rejects fails the task', async () => {
  const task = createTask();
  browser.runtime.sendMessage.mockRejectedValueOnce(new Error('downloads disabled'));

  await task.start();

  expect(task.isFailure()).toBe(true);
  expect(task.lastError).toEqual(new Error('downloads disabled'));
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
