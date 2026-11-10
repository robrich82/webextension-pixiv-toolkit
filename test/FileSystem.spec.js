/**
 * `FileSystem` is the narrowest real call site for `downloads.download`, so it
 * is where a formatted name first becomes a filename the browser is asked for.
 */
import browser from './doubles/browser';
import NameFormatter from '../src/modules/Util/NameFormatter';
import FileSystem from '../src/options_page/modules/FileSystem';

const fileSystem = () => {
  FileSystem.instance = undefined;

  return FileSystem.getDefault();
};

test('requests the download with the given url and filename', async () => {
  await fileSystem().saveFile({ url: 'https://example.test/a.png', filename: 'a.png' });

  expect(browser._fake.lastDownload())
    .toMatchObject({ url: 'https://example.test/a.png', filename: 'a.png' });
});

test('resolves with the download id', async () => {
  const downloadId = await fileSystem().saveFile({
    url: 'https://example.test/a.png',
    filename: 'a.png'
  });

  expect(browser.downloads.items.has(downloadId)).toBe(true);
});

test('downloads under the name the formatter produced', async () => {
  const filename = NameFormatter
    .getFormatter({ context: { illustId: '12345', illustTitle: 'sunset' } })
    .format('{id}_{title}');

  await fileSystem().saveFile({ url: 'https://example.test/a.png', filename: `${filename}.png` });

  expect(browser._fake.lastDownload()).toMatchObject({ filename: '12345_sunset.png' });
});

test('hands a background save to the worker over runtime messaging', async () => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.to === 'ws' && message.action === 'download:saveFile') {
      sendResponse({ downloadId: 7 });
    }

    return true;
  });

  const response = await fileSystem().saveFileInBackground({
    url: 'https://example.test/a.png',
    filename: 'a.png'
  });

  expect(response).toEqual({ downloadId: 7 });
  expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
    to: 'ws',
    action: 'download:saveFile',
    args: { url: 'https://example.test/a.png', filename: 'a.png' }
  });
});

describe('revokeWhenSaved', () => {
  const url = 'blob:moz-extension://manager/1';

  beforeEach(() => {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const startDownload = () => browser.downloads.download({ url, filename: 'a.png' });

  test('keeps the url until the download completes, then revokes it', async () => {
    const downloadId = await startDownload();

    const revoked = fileSystem().revokeWhenSaved(downloadId, url);
    await browser._fake.flush();

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    browser._fake.finishDownload(downloadId);
    await revoked;
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(browser.downloads.onChanged.hasListeners()).toBe(false);
  });

  test('revokes the url when the download is interrupted', async () => {
    const downloadId = await startDownload();

    const revoked = fileSystem().revokeWhenSaved(downloadId, url);
    browser._fake.finishDownload(downloadId, 'interrupted');
    await revoked;

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  test('ignores the other downloads', async () => {
    const downloadId = await startDownload();
    const other = await startDownload();

    fileSystem().revokeWhenSaved(downloadId, url);
    browser._fake.finishDownload(other);
    await browser._fake.flush();

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  test('revokes at once when the download finished before it was asked', async () => {
    const downloadId = await startDownload();
    browser._fake.finishDownload(downloadId);

    await fileSystem().revokeWhenSaved(downloadId, url);

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(browser.downloads.onChanged.hasListeners()).toBe(false);
  });

  test('revokes at once when the save made no download', async () => {
    await fileSystem().revokeWhenSaved(undefined, url);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(browser.downloads.search).not.toHaveBeenCalled();
  });
});
