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

  const watch = downloadId => fileSystem().revokeWhenSaved(downloadId, url);

  const expectNoListeners = () => {
    expect(browser.downloads.onChanged.hasListeners()).toBe(false);
    expect(browser.downloads.onErased.hasListeners()).toBe(false);
  };

  test('keeps the url until the download completes, then revokes it', async () => {
    const downloadId = await startDownload();
    const revoked = watch(downloadId);
    await browser._fake.flush();

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    browser._fake.finishDownload(downloadId);
    await revoked;
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    expectNoListeners();
  });

  test('revokes the url when the download is interrupted', async () => {
    const downloadId = await startDownload();
    const revoked = watch(downloadId);
    await browser._fake.flush();

    browser._fake.finishDownload(downloadId, 'interrupted');
    await revoked;

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  test('keeps the url while Firefox reports the download paused, and revokes once it resumes and completes', async () => {
    const downloadId = await startDownload();
    const revoked = watch(downloadId);
    await browser._fake.flush();

    browser._fake.pauseDownload(downloadId);
    await browser._fake.flush();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    browser._fake.resumeDownload(downloadId);
    await browser._fake.flush();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    browser._fake.finishDownload(downloadId);
    await revoked;
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  test('ignores a change that is not to the state', async () => {
    const downloadId = await startDownload();
    watch(downloadId);
    await browser._fake.flush();
    // A finished download that hasn't announced it yet would be revoked by any lookup.
    browser.downloads.items.get(downloadId).state = 'complete';

    browser._fake.changeDownload(downloadId, { filename: 'b.png' });
    await browser._fake.flush();

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  test('ignores the other downloads', async () => {
    const downloadId = await startDownload();
    const other = await startDownload();

    watch(downloadId);
    await browser._fake.flush();
    browser._fake.finishDownload(other);
    await browser.downloads.erase({ id: other });
    await browser._fake.flush();

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  test('revokes the url when the download is erased while in progress', async () => {
    const downloadId = await startDownload();
    const revoked = watch(downloadId);
    await browser._fake.flush();

    await browser.downloads.erase({ id: downloadId });
    await revoked;

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expectNoListeners();
  });

  test('keeps the url when the lookup fails, and revokes on the next state change', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const downloadId = await startDownload();
    browser.downloads.search.mockRejectedValueOnce(new Error('search failed'));

    const revoked = watch(downloadId);
    await browser._fake.flush();

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    browser._fake.finishDownload(downloadId);
    await revoked;
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  test.each(['complete', 'interrupted'])('revokes at once when the download was already %s', async state => {
    const downloadId = await startDownload();
    browser._fake.finishDownload(downloadId, state);

    await fileSystem().revokeWhenSaved(downloadId, url);

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expectNoListeners();
  });

  test('revokes at once when the browser has no such download', async () => {
    await fileSystem().revokeWhenSaved(404, url);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    expectNoListeners();
  });

  test('revokes at once when the save made no download', async () => {
    await fileSystem().revokeWhenSaved(undefined, url);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(browser.downloads.search).not.toHaveBeenCalled();
  });
});
