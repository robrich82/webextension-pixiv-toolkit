/**
 * Reading a file that ships inside the extension package. The path runs through
 * three nested callbacks — `runtime.getPackageDirectoryEntry`, `getFile`,
 * `fileEntry.file` — and then a `FileReader`, and every one of them is a place
 * a failure can go quiet, because only `getFile` is given an error callback.
 *
 * `getPackageDirectoryEntry` is Chrome's old filesystem bridge rather than a
 * settled extension API, and `FileReader` is a DOM class the `node` test
 * environment does not have, so both are stood up here instead of in
 * `test/doubles/browser.js`.
 */
const browser = require('./doubles/browser').default;
const PackageFileReader = require('../src/modules/Util/PackageFileReader').default;

let packageFiles;
let getFile;

beforeEach(() => {
  packageFiles = new Map();

  getFile = jest.fn((path, options, successCallback, errorCallback) => {
    if (!packageFiles.has(path)) {
      errorCallback({ name: 'NotFoundError', message: `A requested file could not be found: ${path}` });

      return;
    }

    successCallback({
      file: callback => callback({ contents: packageFiles.get(path) })
    });
  });

  // `Browser.getBrowser()` hands back `window.chrome`, which the setup file
  // points at the same fake this spec imports.
  browser.runtime.getPackageDirectoryEntry = jest.fn(callback => callback({ getFile }));

  globalThis.FileReader = class {
    constructor() {
      this.result = undefined;
      this.listeners = {};
    }

    addEventListener(name, listener) {
      (this.listeners[name] = this.listeners[name] || []).push(listener);
    }

    readAsText(file) {
      // Real reads land on a later tick; a caller that assumes otherwise would
      // read `result` before it is there.
      setTimeout(() => {
        this.result = file.contents;
        (this.listeners.load || []).forEach(listener => listener({ target: this }));
      }, 0);
    }
  };
});

afterEach(() => {
  delete browser.runtime.getPackageDirectoryEntry;
  delete globalThis.FileReader;
});

/** Resolves with whatever `read` passes to whichever callback it picks. */
function read(path) {
  return new Promise((resolve, reject) => {
    PackageFileReader.read(path, resolve, reject);
  });
}

test('hands the file text to the callback', async () => {
  packageFiles.set('manifest.json', '{"name":"Pixiv Toolkit"}');

  await expect(read('manifest.json')).resolves.toBe('{"name":"Pixiv Toolkit"}');
});

test('asks the package directory for the path it was given', async () => {
  packageFiles.set('statics/help.md', '# Help');

  await read('statics/help.md');

  expect(browser.runtime.getPackageDirectoryEntry).toHaveBeenCalledTimes(1);
  expect(getFile).toHaveBeenCalledWith('statics/help.md', undefined, expect.any(Function), expect.any(Function));
});

test('routes a missing file to the error callback', async () => {
  await expect(read('nope.json')).rejects.toMatchObject({ name: 'NotFoundError' });
});

test('does not call back with a result when the file is missing', async () => {
  const callback = jest.fn();
  const errorCallback = jest.fn();

  PackageFileReader.read('nope.json', callback, errorCallback);

  await new Promise(resolve => setTimeout(resolve, 0));

  expect(callback).not.toHaveBeenCalled();
  expect(errorCallback).toHaveBeenCalledTimes(1);
});

test('reads each request through its own reader', async () => {
  packageFiles.set('a.json', 'a');
  packageFiles.set('b.json', 'b');

  await expect(Promise.all([read('a.json'), read('b.json')])).resolves.toEqual(['a', 'b']);
});
