/**
 * `FileSystem` is the narrowest real call site for `downloads.download`, so it
 * is where a formatted name first becomes a filename the browser is asked for.
 */
const browser = require('./doubles/browser').default;
const NameFormatter = require('../src/modules/Util/NameFormatter').default;
const FileSystem = require('../src/options_page/modules/FileSystem').default;

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
