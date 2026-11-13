/**
 * The download manager page booted the way downloads.js boots it, through
 * DownloadsBootstrap.__main__(): it listens for messages first and doesn't wait
 * for the stored settings to load.
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

const send = (action, args) => browser.runtime.sendMessage({ action, args });

const addDownloadArgs = id => JSON.parse(JSON.stringify({
  unpackedResource: IllustResource.create({
    id: `${id}`,
    title: `Work ${id}`,
    url: `https://www.pixiv.net/artworks/${id}`,
    illustType: IllustResource.ILLUST_TYPE,
    pages: [`https://i.pximg.net/img/${id}_p0.png`],
    totalPages: 1
  }).unpack(),
  options: { selectedIndexes: [] }
}));

let releaseSettings;

beforeEach(async () => {
  Application.instance = undefined;
  DownloadService.instance = undefined;
  SettingService.instance = undefined;
  DownloadManager.defaultInstance = undefined;
  DownloadTaskNotifier.instance = undefined;
  Db.instance = undefined;
  HistoryRepo.instance = undefined;

  // downloads.html loads JSZip as a global; tasks construct one up front.
  globalThis.JSZip = class FakeJSZip {};

  fakeDownloadFileBackground();
  await browser.storage.local.set({ ...structuredClone(defaultSettings), downloadSaveMode: 1, maxProcessDownloadTasks: 1 });

  // Hold the settings load open, so messages can arrive before it finishes.
  const getSettings = SettingService.prototype.getSettings;
  const held = new Promise(resolve => { releaseSettings = resolve; });
  vi.spyOn(SettingService.prototype, 'getSettings').mockImplementation(function () {
    return held.then(() => getSettings.call(this));
  });

  DownloadsBootstrap.__main__();
  window.$app = Application.app();
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete window.$app;
  delete globalThis.JSZip;
  await Db.getDb().database.delete();
});

test('the background is told the manager is ready only once the stored settings have loaded', async () => {
  let ready;
  send('download:checkReady').then(answer => { ready = answer; });
  await browser._fake.flush();

  expect(ready).toBeUndefined();

  releaseSettings();

  await vi.waitFor(() => expect(ready).toBe(true));
  expect(DownloadManager.getDefault().maxDownloadingTasks).toBe(1);
});

test('a download that arrives before the settings have loaded is made with the stored settings, not the defaults', async () => {
  const added = send('download:addDownload', addDownloadArgs(1));
  await browser._fake.flush();
  releaseSettings();

  await expect(added).resolves.toEqual({ result: true });
  expect(DownloadManager.getDefault().getTask('pixiv_illust:1').downloadSaveMode).toBe(1);
});
