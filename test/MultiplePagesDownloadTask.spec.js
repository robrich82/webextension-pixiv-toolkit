/**
 * Two related MultiplePagesDownloadTask bugs, both covered here:
 *
 * 1. The shipped `fanboxPostRenameRule` default is `{id}_{title}/{pageNum}` -
 *    a `{pageNum}` path segment meant for the per-page "work folder" branch.
 *    Reusing that same rule to name the *whole* zipped post (which has no
 *    single page number) used to leave `{pageNum}` unresolved and, because
 *    the rule contains a `/`, split into a bogus `id_title/{pageNum}.zip`
 *    subfolder - exactly what a default-settings Fanbox download produced.
 *    See `formatPostName`.
 *
 * 2. A post whose sole page is already an archive - e.g. an artist-uploaded
 *    .zip attachment - shouldn't be re-zipped into an outer wrapper, nor
 *    dropped into a per-post work folder alongside a page-numbered copy. It
 *    should just be saved as `<post name>.<ext>` directly. See
 *    `isSingleArchivePage`.
 */
import browser from './doubles/browser';
import MultipleDownloadTask from '../src/options_page/modules/DownloadTasks/MultiplePagesDownloadTask';

const buildContext = () => ({
  id: '12148167',
  title: 'いろいろなえっち絵',
  totalPages: 1
});

const buildTask = (pages, settingsOverrides = {}) => {
  window.$app = {
    settings: Object.assign({
      downloadSaveMode: 0,
      globalZipMultipleImages: 1,
      downloadTasksWhenDownloadingImages: 1,
      downloadRelativeLocation: '',
      enableDownloadMetadata: false,
      dontCreateWorkFolder: 0,
      combinWRRuleAndIRRuleWhenDontCreateWorkFolder: 0
    }, settingsOverrides)
  };

  return new MultipleDownloadTask({
    id: 'fanbox_post:12148167',
    url: 'https://example.fanbox.cc/posts/12148167',
    pages,
    selectedIndexes: [],
    pageNumberStartWithOne: 1,
    pageNumberLength: -1,
    // The real shipped default (src/config/default.js `fanboxPostRenameRule`).
    renameRule: '{id}_{title}/{pageNum}',
    renameImageRule: 'p{pageNum}',
    context: buildContext()
  });
};

beforeEach(() => {
  globalThis.JSZip = class FakeJSZip {
    file() {}

    generateAsync() {
      return Promise.resolve(new Blob(['zip contents']));
    }
  };
});

afterEach(() => {
  delete window.$app;
  delete globalThis.JSZip;
});

test('a single page that is already a zip is saved directly under the post name, without wrapping or a work folder', async () => {
  const task = buildTask(['https://example.fanbox.cc/files/archive.zip']);
  const blob = new Blob(['already a zip']);

  await task.onItemFinish({ blob, args: { index: 0 }, mimeType: 'application/zip' });
  await task.onFinish();

  const saveFileCalls = browser.runtime.sendMessage.mock.calls
    .filter(([message]) => message.action === 'download:saveFile');

  expect(saveFileCalls).toHaveLength(1);
  expect(saveFileCalls[0][0].args.filename).toBe('12148167_いろいろなえっち絵.zip');
  expect(task.isComplete()).toBe(true);
});

test('multiple image pages are still packed into one post-named zip as before', async () => {
  const task = buildTask([
    'https://example.fanbox.cc/images/1.png',
    'https://example.fanbox.cc/images/2.png'
  ]);

  await task.onItemFinish({ blob: new Blob(['a']), args: { index: 0 }, mimeType: 'image/png' });
  await task.onItemFinish({ blob: new Blob(['b']), args: { index: 1 }, mimeType: 'image/png' });
  await task.onFinish();
  await browser._fake.flush();

  const saveFileCalls = browser.runtime.sendMessage.mock.calls
    .filter(([message]) => message.action === 'download:saveFile');

  expect(saveFileCalls).toHaveLength(1);
  expect(saveFileCalls[0][0].args.filename).toBe('12148167_いろいろなえっち絵.zip');
  expect(task.isComplete()).toBe(true);
});

test('a single image page (not an archive) still gets zipped as before', async () => {
  const task = buildTask(['https://example.fanbox.cc/images/1.png']);

  await task.onItemFinish({ blob: new Blob(['a']), args: { index: 0 }, mimeType: 'image/png' });
  await task.onFinish();
  await browser._fake.flush();

  const saveFileCalls = browser.runtime.sendMessage.mock.calls
    .filter(([message]) => message.action === 'download:saveFile');

  expect(saveFileCalls).toHaveLength(1);
  expect(saveFileCalls[0][0].args.filename).toBe('12148167_いろいろなえっち絵.zip');
  expect(task.isComplete()).toBe(true);
});

test('formatPostName drops the {pageNum} segment rather than leaving it unresolved', () => {
  const task = buildTask(['https://example.fanbox.cc/images/1.png']);

  // Before the fix this returned "12148167_いろいろなえっち絵/{pageNum}", which
  // - joined with a `.zip` extension - Chrome's downloads API splits into a
  // "12148167_いろいろなえっち絵" folder containing a literal "{pageNum}.zip".
  expect(task.formatPostName()).toBe('12148167_いろいろなえっち絵');
});
