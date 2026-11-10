import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, test } from 'node:test';
import { closeAll, launch } from './firefox.mjs';

// End-to-end downloads on Firefox, which Playwright can't load an extension
// into. See docs/testing.md.

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
// Each page's bytes end with its own marker, so a file can be matched to the page it came from.
const pageBody = p => Buffer.concat([Buffer.from(PIXEL, 'base64'), Buffer.from(`page ${p}`)]);
const marker = bytes => bytes.subarray(-6).toString();

const TIMEOUT = 90000;
let firefox;

afterEach(async () => {
  await firefox?.close();
  firefox = undefined;
  // A launch the test timed out on never handed back a Firefox to close.
  await closeAll();
});

/** Fail on any uncaught error in a tab, the download manager included. */
function assertNoErrors() {
  assert.deepEqual(firefox.errors, []);
}

test('an illust is fetched by the download manager and saved in a zip', { timeout: TIMEOUT }, async () => {
  const original = '/img-original/img/2024/03/07/10/20/30/10000001_p0.jpg';
  firefox = await launch({
    ajax: {
      '/ajax/illust/10000001': 'pixiv/illust-single.json',
      '/ajax/illust/10000001/pages': 'pixiv/illust-single-pages.json'
    },
    pximg: { [original]: { contentType: 'image/png', body: pageBody(0) } }
  });

  const tab = await firefox.openPanel('https://www.pixiv.net/en/artworks/10000001');
  await firefox.clickButton(tab, 'Download');

  const [file] = await firefox.savedFiles(1);
  assert.equal(file.name, '10000001_harbour at dusk.zip');
  const entries = await firefox.unzip(file.path);
  assert.equal(entries.length, 1);
  assert.equal(marker(Buffer.from(entries[0].base64, 'base64')), 'page 0');
  assert.ok(firefox.pixiv.requests.includes(`https://i.pximg.net${original}`));
  assertNoErrors();
});

test('DL GIF converts the ugoira frames with FFmpeg.wasm', { timeout: TIMEOUT }, async () => {
  firefox = await launch({
    ajax: {
      '/ajax/illust/10000003': 'pixiv/illust-ugoira.json',
      '/ajax/illust/10000003/ugoira_meta': 'pixiv/illust-ugoira-meta.json'
    },
    pximg: {
      '/img-zip-ugoira/img/2024/06/01/08/00/00/10000003_ugoira1920x1080.zip': 'pixiv/illust-ugoira-frames.zip'
    }
  });

  const tab = await firefox.openPanel('https://www.pixiv.net/en/artworks/10000003');
  await firefox.clickButton(tab, 'DL GIF');

  // The frames zip is saved as soon as it arrives; the GIF follows once
  // ffmpeg.wasm has converted the frames.
  const files = await firefox.savedFiles(2);
  assert.deepEqual(files.map(file => file.mime).sort(), ['application/zip', 'image/gif']);
  const gif = files.find(file => file.mime === 'image/gif');
  // test/fixtures/pixiv/illust-ugoira-frames.zip: three 16x16 frames.
  assert.deepEqual(await firefox.decodeImage(gif.path, 'image/gif'), { width: 16, height: 16 });
  assertNoErrors();
});

test('every page of a manga is saved under its configured name', { timeout: TIMEOUT }, async () => {
  const original = p => `/img-original/img/2024/11/23/22/05/00/10000002_p${p}.jpg`;
  firefox = await launch({
    ajax: {
      '/ajax/illust/10000002': 'pixiv/illust-manga.json',
      '/ajax/illust/10000002/pages': 'pixiv/illust-manga-pages.json'
    },
    pximg: Object.fromEntries([0, 1, 2].map(p => [original(p), { contentType: 'image/png', body: pageBody(p) }]))
  });
  await firefox.seedSettings({
    downloadSaveMode: 1,
    mangaRenameRule: '{id}_{title}',
    mangaRenameImageRule: 'page-{pageNum}',
    globalTaskPageNumberStartWithOne: 1
  });

  const tab = await firefox.openPanel('https://www.pixiv.net/en/artworks/10000002');
  await firefox.clickButton(tab, 'Download');

  // Firefox saves under the requested names, subfolders included.
  const files = await firefox.savedFiles(3);
  const folder = '10000002_the lighthouse keeper, ch.2';
  assert.deepEqual(files.map(file => file.name).sort(), [1, 2, 3].map(n => `${folder}/page-${n}.png`));
  // Page n of the post is the file named page-(n+1).
  for (const file of files) {
    const n = Number(file.name.match(/page-(\d)\.png$/)[1]);
    assert.equal(marker(fs.readFileSync(file.path)), `page ${n - 1}`);
  }
  assertNoErrors();
});
