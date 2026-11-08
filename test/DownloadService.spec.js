import browser from './doubles/browser';
import DownloadService from '../src/background/services/DownloadService';

let service;

beforeEach(() => {
  DownloadService.instance = undefined;
  // The fake drops every listener between tests, so the listener must register again.
  DownloadService.onDeterminingFilenameListenered = false;
  service = DownloadService.getService();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const noReceiver = () => Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));

test('keeps asking until a booting manager tab answers', async () => {
  const sendMessage = vi.spyOn(browser.runtime, 'sendMessage')
    .mockImplementationOnce(noReceiver)
    .mockImplementationOnce(() => Promise.resolve(false))
    .mockImplementation(() => Promise.resolve(true));

  const ready = service.waitForDownloadManagerReady();
  await vi.advanceTimersByTimeAsync(400);

  await expect(ready).resolves.toBe(true);
  expect(sendMessage).toHaveBeenCalledTimes(3);
});

test('gives up when the manager never answers', async () => {
  vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(noReceiver);

  const ready = service.waitForDownloadManagerReady(1000);
  await vi.advanceTimersByTimeAsync(1200);

  await expect(ready).resolves.toBe(false);
});

test('waits for a tab that is already open but still booting', async () => {
  vi.spyOn(service, 'getDownloadManagerTab').mockResolvedValue({ id: 1 });
  vi.spyOn(browser.runtime, 'sendMessage')
    .mockImplementationOnce(noReceiver)
    .mockImplementation(() => Promise.resolve(true));

  const ready = service.ensureDownloadManagerOpen();
  await vi.advanceTimersByTimeAsync(200);

  await expect(ready).resolves.toBe(true);
});

describe('onDeterminingFilename', () => {
  const url = 'blob:chrome-extension://id/1b2c';

  test('names a file saved through saveFile as asked, once, letting a clash be uniquified', async () => {
    const downloadId = await service.saveFile({ url, filename: 'pixiv/Work 1.zip' });

    expect(browser.downloads.items.get(downloadId)).toMatchObject({ url, filename: 'pixiv/Work 1.zip' });
    expect(browser._fake.determineFilename({ url, filename: '1b2c' })).toEqual({ filename: 'pixiv/Work 1.zip', conflictAction: 'uniquify' });
    expect(browser._fake.determineFilename({ url, filename: '1b2c' })).toEqual({ filename: '1b2c', conflictAction: 'uniquify' });
  });

  test("keeps the browser's own name for a download it didn't start", () => {
    expect(browser._fake.determineFilename({ url: 'https://example.test/a.png', filename: 'a.png' }))
      .toEqual({ filename: 'a.png', conflictAction: 'uniquify' });
  });

  test('registers once, however many services are made', () => {
    DownloadService.instance = undefined;
    DownloadService.getService();

    expect(browser.downloads.onDeterminingFilename.hasListeners()).toBe(true);
    expect(browser.downloads.onDeterminingFilename.listeners).toHaveLength(1);
  });

  test("skips the listener where the browser has no onDeterminingFilename (Firefox), and tries again next time", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const event = browser.downloads.onDeterminingFilename;
    delete browser.downloads.onDeterminingFilename;
    DownloadService.onDeterminingFilenameListenered = false;

    try {
      DownloadService.instance = undefined;
      expect(() => DownloadService.getService()).not.toThrow();
      expect(DownloadService.onDeterminingFilenameListenered).toBe(false);
      expect(warn).toHaveBeenCalled();
    } finally {
      browser.downloads.onDeterminingFilename = event;
    }
  });
});
