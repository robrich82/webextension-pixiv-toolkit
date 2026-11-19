import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, test } from 'node:test';
import { PIXEL } from './fakePixiv.mjs';
import { closeAll, launch } from './firefox.mjs';
import { probeVideo, videoSize } from '../test/helpers/probeVideo.mjs';

// End-to-end downloads on Firefox, which Playwright can't load an extension
// into. See docs/testing.md.

// Each page's bytes end with its own marker, so a file can be matched to the page it came from.
const pageBody = p => Buffer.concat([PIXEL, Buffer.from(`page ${p}`)]);
const marker = bytes => bytes.subarray(-6).toString();

const TIMEOUT = 90000;
let firefox;

afterEach(async () => {
  try {
    await firefox?.close();
  } finally {
    firefox = undefined;
    // A launch the test timed out on never handed back a Firefox to close.
    await closeAll();
  }
});

/** Fail on any uncaught error in a tab, the download manager included. */
function assertNoErrors() {
  assert.deepEqual(firefox.errors, []);
}

test('an illust is downloaded and saved in a zip', { timeout: TIMEOUT }, async () => {
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
  // #391: the button follows the task's progress through to the tick.
  await firefox.waitForButton(tab, 'Download ✔');
  assertNoErrors();
});

/**
 * Launch on the ugoira, with the frames zip it downloads. `odd` serves the twelve 37x35 PNG frames
 * instead.
 */
async function launchUgoira({ odd = false } = {}) {
  firefox = await launch({
    ajax: {
      '/ajax/illust/10000003': 'pixiv/illust-ugoira.json',
      '/ajax/illust/10000003/ugoira_meta': odd ? 'pixiv/illust-ugoira-meta-odd.json' : 'pixiv/illust-ugoira-meta.json'
    },
    pximg: {
      '/img-zip-ugoira/img/2024/06/01/08/00/00/10000003_ugoira1920x1080.zip':
        odd ? 'pixiv/illust-ugoira-frames-odd.zip' : 'pixiv/illust-ugoira-frames.zip'
    }
  });
}

/** Launch on the ugoira, with `settings` stored, click a format button and return the converted animation. */
async function convertUgoira(label, mime, { odd = false, settings } = {}) {
  await launchUgoira({ odd });

  if (settings) {
    await firefox.seedSettings(settings);
  }

  const tab = await firefox.openPanel('https://www.pixiv.net/en/artworks/10000003');
  await firefox.clickButton(tab, label);

  // The animation is the only file a conversion saves.
  const files = await firefox.savedFiles(1);
  assert.deepEqual(files.map(file => file.mime), [mime]);

  return files[0];
}

// test/fixtures/pixiv/illust-ugoira-frames.zip: three 16x16 frames.
const FRAME_SIZE = { width: 16, height: 16 };
// test/fixtures/pixiv/illust-ugoira-meta-odd.json's delays, as frame starts and a duration in seconds.
const ODD_DELAYS = [40, 40, 40, 40, 60, 60, 60, 60, 80, 80, 80, 200];
const ODD_TIMES = {
  timestamps: ODD_DELAYS.map((_, i) => ODD_DELAYS.slice(0, i).reduce((sum, delay) => sum + delay, 0) / 1000),
  duration: ODD_DELAYS.reduce((sum, delay) => sum + delay, 0) / 1000
};

for (const { label, mime } of [
  { label: 'DL GIF', mime: 'image/gif' },
  { label: 'DL APNG', mime: 'image/apng' },
  { label: 'DL WEBM', mime: 'video/webm' },
  { label: 'DL MP4', mime: 'video/mp4' }
]) {
  test(`${label} converts the ugoira frames`, { timeout: TIMEOUT }, async () => {
    const animation = await convertUgoira(label, mime);

    const { duration, ...size } = await firefox.decodeMedia(animation.path, mime);
    assert.deepEqual(size, FRAME_SIZE);
    if (mime.startsWith('video/')) {
      assert.ok(duration > 0, `duration ${duration}`);
    }
    assertNoErrors();
  });
}

test('DL Zip saves the frames zip and converts nothing', { timeout: TIMEOUT }, async () => {
  await launchUgoira();

  const tab = await firefox.openPanel('https://www.pixiv.net/en/artworks/10000003');
  await firefox.clickButton(tab, 'DL Zip');

  const [file] = await firefox.savedFiles(1);
  assert.equal(file.name, '10000003_rain loop.zip');
  const entries = await firefox.unzip(file.path);
  // With animation.json, which the default animationJsonFormat packs.
  assert.deepEqual(entries.map(entry => entry.name), ['000000.jpg', '000001.jpg', '000002.jpg', 'animation.json']);
  await firefox.waitForButton(tab, 'DL Zip ✔');
  assertNoErrors();
});

test('DL WEBM encodes VP9 through WebCodecs, each frame for its own delay', { timeout: TIMEOUT }, async () => {
  const animation = await convertUgoira('DL WEBM', 'video/webm');

  // The fixture's delays are 100, 100 and 150ms.
  assert.deepEqual(await probeVideo(animation.path), { codec: 'vp9', timestamps: [0, 0.1, 0.2], duration: 0.35 });
  assertNoErrors();
});

test('DL WEBM keeps an odd frame size and every frame of a longer PNG ugoira', { timeout: TIMEOUT }, async () => {
  const animation = await convertUgoira('DL WEBM', 'video/webm', { odd: true });

  // Twelve frames: more than the encoder queues before add() waits for it.
  assert.deepEqual(await probeVideo(animation.path), { codec: 'vp9', ...ODD_TIMES });
  const { width, height } = await firefox.decodeMedia(animation.path, 'video/webm');
  assert.deepEqual({ width, height }, { width: 37, height: 35 });
  assertNoErrors();
});

// The odd fixture, not the 16x16 one: Firefox 160's Windows H.264 encoder fails below 34px and would fall back to VP9.
test('DL MP4 encodes H.264 through WebCodecs, padded to an even size, each frame for its own delay', { timeout: TIMEOUT }, async () => {
  const animation = await convertUgoira('DL MP4', 'video/mp4', { odd: true });

  assert.deepEqual(await probeVideo(animation.path), { codec: 'avc', ...ODD_TIMES });
  const { width, height } = await firefox.decodeMedia(animation.path, 'video/mp4');
  assert.deepEqual({ width, height }, { width: 38, height: 36 });
  assertNoErrors();
});

test('DL MP4 encodes the codec its setting names', { timeout: TIMEOUT }, async () => {
  const animation = await convertUgoira('DL MP4', 'video/mp4', { settings: { ugoiraMP4Codec: 'vp9' } });

  assert.equal((await probeVideo(animation.path)).codec, 'vp9');
  assertNoErrors();
});

for (const { label, mime, extension } of [
  { label: 'DL MKV', mime: 'video/x-matroska', extension: '.mkv' },
  { label: 'DL MOV', mime: 'video/quicktime', extension: '.mov' }
]) {
  test(`${label} encodes H.264 through WebCodecs, padded to an even size, each frame for its own delay`, { timeout: TIMEOUT }, async () => {
    const animation = await convertUgoira(label, mime, { odd: true });

    assert.ok(animation.name.endsWith(extension), animation.name);
    assert.deepEqual(await probeVideo(animation.path), { codec: 'avc', ...ODD_TIMES });
    assert.deepEqual(await videoSize(animation.path), { width: 38, height: 36 });
    assertNoErrors();
  });
}

test('a novel is saved as a text file with its url, author, title and text', { timeout: TIMEOUT }, async () => {
  const url = 'https://www.pixiv.net/novel/show.php?id=40000001';
  firefox = await launch({ ajax: { '/ajax/novel/40000001': 'pixiv/novel-single.json' } });

  const tab = await firefox.openPanel(url);
  await firefox.clickButton(tab, 'Download');

  const [file] = await firefox.savedFiles(1);
  assert.equal(file.name, '40000001_the tide comes in.txt');
  assert.deepEqual(fs.readFileSync(file.path, 'utf8').split('\r\n\r\n'), [
    url,
    'tidewriter',
    'the tide comes in',
    // The parser turns each line break into <br />, and the book writes those as \r\n.
    'The tide comes in.\r\nIt goes out again.'
  ]);
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
