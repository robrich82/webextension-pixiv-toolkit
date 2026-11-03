const browser = require('./doubles/browser').default;
const DownloadService = require('../src/background/services/DownloadService').default;

let service;

beforeEach(() => {
  DownloadService.instance = undefined;
  service = DownloadService.getService();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const noReceiver = () => Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));

test('keeps asking until a booting manager tab answers', async () => {
  const sendMessage = jest.spyOn(browser.runtime, 'sendMessage')
    .mockImplementationOnce(noReceiver)
    .mockImplementationOnce(() => Promise.resolve(false))
    .mockImplementation(() => Promise.resolve(true));

  const ready = service.waitForDownloadManagerReady();
  await jest.advanceTimersByTimeAsync(400);

  await expect(ready).resolves.toBe(true);
  expect(sendMessage).toHaveBeenCalledTimes(3);
});

test('gives up when the manager never answers', async () => {
  jest.spyOn(browser.runtime, 'sendMessage').mockImplementation(noReceiver);

  const ready = service.waitForDownloadManagerReady(1000);
  await jest.advanceTimersByTimeAsync(1200);

  await expect(ready).resolves.toBe(false);
});

test('waits for a tab that is already open but still booting', async () => {
  jest.spyOn(service, 'getDownloadManagerTab').mockResolvedValue({ id: 1 });
  jest.spyOn(browser.runtime, 'sendMessage')
    .mockImplementationOnce(noReceiver)
    .mockImplementation(() => Promise.resolve(true));

  const ready = service.ensureDownloadManagerOpen();
  await jest.advanceTimersByTimeAsync(200);

  await expect(ready).resolves.toBe(true);
});
