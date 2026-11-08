import browser from './doubles/browser';
import DownloadService from '../src/background/services/DownloadService';

let service;

beforeEach(() => {
  DownloadService.instance = undefined;
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
