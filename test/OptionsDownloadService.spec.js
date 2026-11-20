/**
 * The download manager page's DownloadService, reached the way the content
 * script reaches it: `runtime.sendMessage` into DownloadsApplication.onMessage,
 * on an app booted from storage as DownloadsBootstrap boots it. Behind it are
 * the real DownloadManager, adapters and tasks, and a real Dexie database; the
 * background's end of each file transfer is fakeDownloadFileBackground.
 */
import './helpers/fakeIndexedDb';
import browser from './doubles/browser';
import { fakeDownloadFileBackground } from './helpers/downloadFileBackground';
import defaultSettings from '@/config/default';
import Application from '@/options_page/DownloadsApplication';
import DownloadsBootstrap from '@/options_page/DownloadsBootstrap';
import DownloadService from '@/options_page/services/DownloadService';
import SettingService from '@/options_page/services/SettingService';
import DownloadManager from '@/options_page/modules/DownloadManager';
import DownloadTaskNotifier from '@/options_page/modules/DownloadTaskNotifier';
import IllustResource from '@/modules/PageResource/Pixiv/IllustResource';
import Db from '@/modules/Db/Db';
import HistoryRepo from '@/modules/Db/Repository/HistoryRepo';
import BackgroundApplication from '@/background/Application';
import HistoryService from '@/background/services/HistoryService';

let app;
let background;

const send = (action, args) => browser.runtime.sendMessage({ action, args });

/** What App.vue sends for an illustration: the unpacked resource, JSON round-tripped. */
const addDownloadArgs = (id, options = {}) => JSON.parse(JSON.stringify({
  unpackedResource: IllustResource.create({
    id: `${id}`,
    title: `Work ${id}`,
    url: `https://www.pixiv.net/artworks/${id}`,
    illustType: IllustResource.ILLUST_TYPE,
    pages: [`https://i.pximg.net/img/${id}_p0.png`],
    totalPages: 1
  }).unpack(),
  options: { selectedIndexes: [], ...options }
}));

/** The same for an ugoira, whose options name the format to convert to. */
const addUgoiraDownloadArgs = (id, options = {}) => JSON.parse(JSON.stringify({
  unpackedResource: IllustResource.create({
    id: `${id}`,
    title: `Work ${id}`,
    url: `https://www.pixiv.net/artworks/${id}`,
    illustType: IllustResource.UGOIRA_TYPE,
    illustOriginalSrc: `https://i.pximg.net/img-zip-ugoira/${id}_ugoira1920x1080.zip`,
    illustFrames: [{ file: '000000.jpg', delay: 100 }],
    pages: [],
    totalPages: 1
  }).unpack(),
  options: { selectedIndexes: [], ...options }
}));

beforeEach(async () => {
  Application.instance = undefined;
  DownloadService.instance = undefined;
  SettingService.instance = undefined;
  DownloadManager.defaultInstance = undefined;
  DownloadTaskNotifier.instance = undefined;
  Db.instance = undefined;
  HistoryRepo.instance = undefined;

  globalThis.JSZip = class FakeJSZip {
    file() {}

    generateAsync() {
      return Promise.resolve(new Blob(['zip']));
    }
  };

  background = fakeDownloadFileBackground();
  await browser.storage.local.set(structuredClone(defaultSettings));

  app = Application.createApp();
  DownloadsBootstrap.bindEvents(app);
  await app.onBeforeBoot();
  window.$app = app;
});

afterEach(async () => {
  delete window.$app;
  delete globalThis.JSZip;
  await Db.getDb().database.delete();
});

const manager = () => DownloadManager.getDefault();

const storedSetting = async key => (await browser.storage.local.get(key))[key];

describe('download:addDownload', () => {
  test('hands the task to the manager, which starts it, and counts the download', async () => {
    const added = vi.fn();
    app.getService('download').addListener(DownloadService.TASK_ADDED_EVENT, added);

    await expect(send('download:addDownload', addDownloadArgs(1))).resolves.toEqual({ result: true });
    await browser._fake.flush();

    const task = manager().getTask('pixiv_illust:1');
    expect(task.isDownloading()).toBe(true);
    expect(added).toHaveBeenCalledWith(task);
    expect(background.requests.map(request => request.url)).toEqual(['https://i.pximg.net/img/1_p0.png']);
    expect(await storedSetting('statIllustDownloaded')).toBe(1);
  });

  test.each([
    ['zip', 'zip', ''],
    ['gif', 'gif', ''],
    ['apng', 'apng', ''],
    ['webm', 'webm', '']
  ])('an ugoira with convert type %s gets its own task, of convert type %s', async (ugoiraConvertType, convertType, args) => {
    const frames = [{ file: '000000.jpg', delay: 100 }];
    const resource = IllustResource.create({
      id: '7',
      title: 'Work 7',
      url: 'https://www.pixiv.net/artworks/7',
      illustType: IllustResource.UGOIRA_TYPE,
      illustOriginalSrc: 'https://i.pximg.net/img-zip-ugoira/img/7_ugoira1920x1080.zip',
      illustFrames: frames
    });

    await send('download:addDownload', JSON.parse(JSON.stringify({
      unpackedResource: resource.unpack(),
      options: { selectedIndexes: [], ugoiraConvertType }
    })));

    const task = manager().getTask(resource.getDownloadTaskId(ugoiraConvertType));
    expect(task.id).toBe(`pixiv_illust:7:${ugoiraConvertType}`);
    expect(task.options).toMatchObject({ convertType, ffmpegCommandArgs: args, frames });
    expect(task.isZipOnly()).toBe(convertType === 'zip');
  });

  test('a video ugoira task tries the codec its format is set to, as the setting is when it is added', async () => {
    const codec = async id => {
      await send('download:addDownload', addUgoiraDownloadArgs(id, { ugoiraConvertType: 'mp4' }));

      return manager().getTask(`pixiv_illust:${id}:mp4`).options.codec;
    };

    expect(await codec(8)).toBe('avc');

    await browser.storage.local.set({ ugoiraMP4Codec: 'vp9' });
    await browser._fake.flush();
    expect(await codec(9)).toBe('vp9');

    // An install from before the setting: the encoder falls back to the container's default.
    await browser.storage.local.remove('ugoiraMP4Codec');
    await browser._fake.flush();
    expect(await codec(10)).toBeUndefined();
  });

  test('a resource already in the manager is refused by name, so the page can offer to redownload', async () => {
    await send('download:addDownload', addDownloadArgs(1));

    await expect(send('download:addDownload', addDownloadArgs(1))).resolves.toEqual({
      result: false,
      errorName: 'DownloadTaskExistsError'
    });
    expect(await storedSetting('statIllustDownloaded')).toBe(1);
  });

  test('redownload replaces a task that has finished', async () => {
    await send('download:addDownload', addDownloadArgs(1));
    const finished = manager().getTask('pixiv_illust:1');
    await browser._fake.flush();
    background.request('https://i.pximg.net/img/1_p0.png').complete();
    await vi.waitFor(() => expect(finished.isComplete()).toBe(true));

    await expect(send('download:addDownload', addDownloadArgs(1, { redownload: true }))).resolves.toEqual({ result: true });

    expect(manager().getTask('pixiv_illust:1')).not.toBe(finished);
    expect(finished.isDelete).toBe(true);
  });

  test('redownload leaves a task that is still downloading alone', async () => {
    await send('download:addDownload', addDownloadArgs(1));
    const running = manager().getTask('pixiv_illust:1');

    await expect(send('download:addDownload', addDownloadArgs(1, { redownload: true }))).resolves.toEqual({
      result: false,
      errorName: 'DownloadTaskExistsError'
    });
    expect(manager().getTask('pixiv_illust:1')).toBe(running);
  });
});

describe('download:addDownload for an ugoira', () => {
  test('a known format starts a task named after it', async () => {
    await expect(send('download:addDownload', addUgoiraDownloadArgs(3, { ugoiraConvertType: 'apng' })))
      .resolves.toEqual({ result: true });

    const task = manager().getTask('pixiv_illust:3:apng');
    expect(task.options.convertType).toBe('apng');
  });

  // The Custom download, which ran a stored FFmpeg command, has gone: no format is refused, not converted somehow.
  test.each([
    ['no format', {}],
    ['an unknown format', { ugoiraConvertType: 'custom' }]
  ])('%s is refused without adding a task', async (_, options) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(send('download:addDownload', addUgoiraDownloadArgs(3, options))).resolves.toBeUndefined();

    expect(manager().tasks.size).toBe(0);
    expect(error).toHaveBeenCalledWith(
      'onMessage handler failed for action "download:addDownload"',
      expect.objectContaining({ message: `Unknown ugoira convert type: ${options.ugoiraConvertType}` })
    );
  });
});

describe('download history', () => {
  const work = 'https://i.pximg.net/img/1_p0.png';
  const historyItem = () => Db.getDb().historyRepo().getItem({ uid: 'pixiv_illust:1' });

  beforeEach(() => {
    // The background's HistoryService answers history:itemDownload, as it does in the extension.
    BackgroundApplication.instance = undefined;
    HistoryService.instance = undefined;
    const backgroundApp = BackgroundApplication.createApp();
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => backgroundApp.onMessage(message, sender, sendResponse));
    // The real background saves the files, so the fake mustn't answer them too.
    background.leaveSaves(() => true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('is recorded when the task completes, not when it is queued', async () => {
    const before = Math.floor(Date.now() / 1000);
    await send('download:addDownload', addDownloadArgs(1));
    await browser._fake.flush();
    expect(await send('download:checkIfDownloaded', { uid: 'pixiv_illust:1' })).toBe(0);

    background.request(work).complete();
    await vi.waitFor(() => expect(manager().getTask('pixiv_illust:1').isComplete()).toBe(true));
    await vi.waitFor(async () => expect(await historyItem()).toBeDefined());

    expect(await historyItem()).toMatchObject({
      uid: 'pixiv_illust:1',
      title: 'Work 1',
      url: 'https://www.pixiv.net/artworks/1'
    });
    expect(await send('download:checkIfDownloaded', { uid: 'pixiv_illust:1' })).toBeGreaterThanOrEqual(before);
  });

  test('a task that fails leaves no download history', async () => {
    await send('download:addDownload', addDownloadArgs(1));
    await browser._fake.flush();

    background.request(work).fail('HTTP 404');
    await vi.waitFor(() => expect(manager().getTask('pixiv_illust:1').isFailure()).toBe(true));
    await browser._fake.flush();

    expect(await historyItem()).toBeUndefined();
    expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'history:itemDownload' }));
  });

  test('a task deleted before it completes leaves no download history', async () => {
    await send('download:addDownload', addDownloadArgs(1));
    await browser._fake.flush();

    // The manager page calls the service directly.
    await app.getService('download').deleteDownload('pixiv_illust:1');
    await browser._fake.flush();

    expect(await historyItem()).toBeUndefined();
  });

  test('a redownload records the work again once it completes', async () => {
    await send('download:addDownload', addDownloadArgs(1));
    await browser._fake.flush();
    background.request(work).complete();
    await vi.waitFor(async () => expect(await historyItem()).toBeDefined());

    await send('download:addDownload', addDownloadArgs(1, { redownload: true }));
    await browser._fake.flush();
    background.request(work).complete();
    await vi.waitFor(() => expect(manager().getTask('pixiv_illust:1').isComplete()).toBe(true));
    await browser._fake.flush();

    expect(browser.runtime.sendMessage.mock.calls.filter(([message]) => message.action === 'history:itemDownload')).toHaveLength(2);
  });
});

describe('download:checkIfDownloaded', () => {
  test('answers with when a uid was downloaded, and 0 when it was only visited or never seen', async () => {
    const history = Db.getDb().historyRepo();
    await history.addItem({ uid: 'pixiv_illust:1', title: 'Work 1', visited_at: 10, downloaded_at: 20 });
    await history.addItem({ uid: 'pixiv_illust:2', title: 'Work 2', visited_at: 30 });

    await expect(send('download:checkIfDownloaded', { uid: 'pixiv_illust:1' })).resolves.toBe(20);
    await expect(send('download:checkIfDownloaded', { uid: 'pixiv_illust:2' })).resolves.toBe(0);
    await expect(send('download:checkIfDownloaded', { uid: 'pixiv_illust:3' })).resolves.toBe(0);
  });
});

describe('updateDownloadedStat', () => {
  test.each([
    ['PIXIV_UGOIRA', 'statUgoiraDownloaded'],
    ['PIXIV_ILLUST', 'statIllustDownloaded'],
    ['PIXIV_MANGA', 'statMangaDownloaded'],
    ['PIXIV_NOVEL', 'statNovelDownloaded'],
    ['PIXIV_COMIC_EPISODE', 'statComicEpisodeDownloaded'],
    ['FANBOX_POST', 'statUnkownDownloaded']
  ])('counts a %s download under %s, from 1 when it has no count yet', async (type, key) => {
    const service = app.getService('download');
    await browser.storage.local.set({ [key]: 4 });

    service.updateDownloadedStat({ type });
    await vi.waitFor(async () => expect(await storedSetting(key)).toBe(5));

    await browser.storage.local.remove(key);
    service.updateDownloadedStat({ type });
    await vi.waitFor(async () => expect(await storedSetting(key)).toBe(1));
  });
});

describe('download:download', () => {
  test('saves a url under the filename asked for, without its leading slash, with saveAs as a boolean', async () => {
    const downloadId = await send('download:download', { saveAs: 1, filename: '/pixiv/1.zip', url: 'https://example.test/1.zip' });

    expect(browser._fake.lastDownload()).toEqual({
      id: downloadId,
      state: 'in_progress',
      saveAs: true,
      filename: 'pixiv/1.zip',
      url: 'https://example.test/1.zip'
    });
  });

  test('saves raw bytes as a blob typed from the filename', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');

    await send('download:download', { filename: 'notes.txt', data: [104, 105] });

    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('text/plain');
    expect(await blob.text()).toBe('hi');
    expect(browser._fake.lastDownload()).toMatchObject({
      saveAs: false,
      filename: 'notes.txt',
      url: createObjectURL.mock.results[0].value
    });
    createObjectURL.mockRestore();
  });
});

describe("what the background asks", () => {
  test('download:checkReady is true once the service has its manager', async () => {
    await expect(send('download:checkReady')).resolves.toBe(true);
  });

  test('download:checkIfDownloadManagerOpened reports whether this tab is the active manager, and where it is', async () => {
    browser._fake.setCurrentTab({ id: 5, windowId: 2 });
    window.__CURRENT_ACTIVE_DM__ = true;

    try {
      await expect(send('download:checkIfDownloadManagerOpened')).resolves.toEqual({ result: true, data: { tabId: 5, windowId: 2 } });
    } finally {
      delete window.__CURRENT_ACTIVE_DM__;
    }
  });
});

// DownloadManager.vue calls these on the service directly, with a bare id.
describe("what the manager page calls", () => {
  test('lists the tasks, flushes what changed, and pauses, stops and deletes a task by id', async () => {
    const service = app.getService('download');
    await send('download:addDownload', addDownloadArgs(1));
    await send('download:addDownload', addDownloadArgs(2));
    await browser._fake.flush();

    expect(service.getAvaliableDownloads().map(json => json.id)).toEqual(['pixiv_illust:1', 'pixiv_illust:2']);
    expect(service.flushChangedTasks().map(json => json.id)).toEqual(['pixiv_illust:1', 'pixiv_illust:2']);
    expect(service.flushChangedTasks()).toEqual([]);

    await service.pauseDownload('pixiv_illust:1');
    expect(manager().getTask('pixiv_illust:1').isPaused()).toBe(true);

    await service.stopDownload('pixiv_illust:2');
    await browser._fake.flush();
    expect(background.aborted).toEqual(['https://i.pximg.net/img/1_p0.png', 'https://i.pximg.net/img/2_p0.png']);

    await service.deleteDownload('pixiv_illust:2');
    expect(service.getAvaliableDownloads().map(json => json.id)).toEqual(['pixiv_illust:1']);
  });

  test('showInFolder reveals the saved file', () => {
    app.getService('download').showInFolder(7);

    expect(browser.downloads.show).toHaveBeenCalledWith(7);
  });
});
