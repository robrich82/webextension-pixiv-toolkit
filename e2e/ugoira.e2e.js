const fs = require('fs');
const JSZip = require('jszip');
const {
  test, expect, mockPixiv, collectErrors, openPanel, waitForDownloads, decodeMedia, decodeApngFrames,
  recordSaveNames, savedFiles, seedSettings
} = require('./fixtures');

const UGOIRA_URL = 'https://www.pixiv.net/en/artworks/10000003';
// test/fixtures/pixiv/illust-ugoira-frames.zip: three 16x16 frames, 350ms in all.
const FRAME_SIZE = { width: 16, height: 16 };
// test/fixtures/pixiv/illust-ugoira-meta-odd.json's delays, as frame starts and a duration in seconds.
const ODD_DELAYS = [40, 40, 40, 40, 60, 60, 60, 60, 80, 80, 80, 200];
const ODD_TIMES = {
  timestamps: ODD_DELAYS.map((_, i) => ODD_DELAYS.slice(0, i).reduce((sum, delay) => sum + delay, 0) / 1000),
  duration: ODD_DELAYS.reduce((sum, delay) => sum + delay, 0) / 1000
};

/**
 * The ugoira's routes, with `odd` serving the twelve 37x35 PNG frames instead, and `moving` the four
 * of probeApng's MOVING.
 */
const ugoiraRoutes = ({ odd = false, moving = false } = {}) => {
  const variant = odd ? '-odd' : moving ? '-moving' : '';

  return {
    ajax: {
      '/ajax/illust/10000003': 'pixiv/illust-ugoira.json',
      '/ajax/illust/10000003/ugoira_meta': `pixiv/illust-ugoira-meta${variant}.json`
    },
    pximg: {
      '/img-zip-ugoira/img/2024/06/01/08/00/00/10000003_ugoira1920x1080.zip': `pixiv/illust-ugoira-frames${variant}.zip`
    }
  };
};

test.beforeEach(async ({ context }) => {
  await mockPixiv(context, ugoiraRoutes());
});

/**
 * Click a format button and wait for the animation, the only file a conversion saves.
 * @returns {Promise<chrome.downloads.DownloadItem>} The animation
 */
async function convert(context, serviceWorker, label, mime) {
  const page = await openPanel(context, UGOIRA_URL);

  await page.getByText(label, { exact: true }).click();

  const items = await waitForDownloads(serviceWorker, 1);
  expect(items.map(item => item.mime)).toEqual([mime]);
  expect(items[0].fileSize).toBeGreaterThan(0);

  return items[0];
}

const formats = [
  { label: 'DL GIF', mime: 'image/gif' },
  { label: 'DL APNG', mime: 'image/apng' },
  { label: 'DL WEBM', mime: 'video/webm' },
  { label: 'DL MP4', mime: 'video/mp4' }
];

for (const { label, mime } of formats) {
  test(`${label} saves the converted animation, without the frames zip`, async ({ context, serviceWorker }) => {
    const errors = collectErrors(context);

    const animation = await convert(context, serviceWorker, label, mime);

    const decoded = await decodeMedia(context, animation.filename, mime);
    expect(decoded).toMatchObject(FRAME_SIZE);
    if (mime.startsWith('video/')) {
      expect(decoded.duration).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  });
}

test('DL Zip saves the frames zip and converts nothing', async ({ context, serviceWorker }) => {
  const errors = collectErrors(context);
  await recordSaveNames(serviceWorker);
  const page = await openPanel(context, UGOIRA_URL);

  await page.getByText('DL Zip', { exact: true }).click();

  const [file] = await savedFiles(serviceWorker, 1);
  expect(file.mime).toBe('application/zip');
  expect(file.name).toBe('10000003_rain loop.zip');
  const zip = await JSZip.loadAsync(fs.readFileSync(file.path));
  // With animation.json, which the default animationJsonFormat packs.
  expect(Object.keys(zip.files)).toEqual(['000000.jpg', '000001.jpg', '000002.jpg', 'animation.json']);
  // The button ticks once the zip is saved, with no conversion to wait for.
  await expect(page.getByText('DL Zip ✔', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('DL GIF gives each frame its own palette and delay, and loops', async ({ context, serviceWorker }) => {
  const errors = collectErrors(context);
  const { probeGif, nearColors } = await import('../test/helpers/probeGif.mjs');

  const animation = await convert(context, serviceWorker, 'DL GIF', 'image/gif');

  const gif = probeGif(fs.readFileSync(animation.filename));
  expect(gif).toMatchObject({ ...FRAME_SIZE, loops: 0 });
  // The fixture's frames are red, green and blue, for 100, 100 and 150ms.
  expect(gif.frames.map(frame => frame.delay)).toEqual([100, 100, 150]);
  expect(nearColors(gif.frames, [[254, 0, 0], [0, 129, 0], [0, 0, 254]])).toBe(true);
  // Frames after the first carry their own palette, where FFmpeg's GIF shared one.
  expect(gif.frames.map(frame => frame.localPalette)).toEqual([false, true, true]);
  expect(errors).toEqual([]);
});

test('DL GIF keeps an odd frame size and every frame of a longer PNG ugoira', async ({ context, serviceWorker }) => {
  const errors = collectErrors(context);
  await context.unrouteAll();
  await mockPixiv(context, ugoiraRoutes({ odd: true }));
  const { probeGif } = await import('../test/helpers/probeGif.mjs');

  const animation = await convert(context, serviceWorker, 'DL GIF', 'image/gif');

  const gif = probeGif(fs.readFileSync(animation.filename));
  expect(gif).toMatchObject({ width: 37, height: 35, loops: 0 });
  expect(gif.frames.map(frame => frame.delay)).toEqual(ODD_DELAYS);
  // Each frame has two colours, which a palette of its own keeps.
  expect(gif.frames.map(frame => frame.distinctColors)).toEqual(ODD_DELAYS.map(() => 2));
  expect(errors).toEqual([]);
});

test('DL APNG gives JPEG frames their delays as RGB, and loops', async ({ context, serviceWorker }) => {
  const errors = collectErrors(context);
  const { probeApng, nearColors } = await import('../test/helpers/probeApng.mjs');

  const animation = await convert(context, serviceWorker, 'DL APNG', 'image/apng');

  const apng = probeApng(fs.readFileSync(animation.filename));
  expect(apng).toMatchObject({ ...FRAME_SIZE, colorType: 2, plays: 0 });
  // The fixture's frames are red, green and blue, for 100, 100 and 150ms.
  expect(apng.frames.map(frame => frame.delay)).toEqual([100, 100, 150]);
  expect(nearColors(apng.frames, [[254, 0, 0], [0, 129, 0], [0, 0, 254]])).toBe(true);
  expect(errors).toEqual([]);
});

test('DL APNG keeps PNG frames exactly, semi-transparent pixels too, each after the first holding only what moved', async ({ context, serviceWorker }) => {
  const errors = collectErrors(context);
  await context.unrouteAll();
  await mockPixiv(context, ugoiraRoutes({ moving: true }));
  const { probeApng, zipFrames, MOVING } = await import('../test/helpers/probeApng.mjs');

  const animation = await convert(context, serviceWorker, 'DL APNG', 'image/apng');

  const apng = probeApng(fs.readFileSync(animation.filename));
  expect(apng).toMatchObject({ width: 37, height: 35, colorType: 6, plays: 0 });
  expect(apng.frames.map(frame => frame.delay)).toEqual(MOVING.delays);
  expect(apng.frames.map(({ x, y, width, height }) => [x, y, width, height])).toEqual(MOVING.areas);
  const expected = await zipFrames(MOVING.zip);
  expect(apng.frames.map(frame => Array.from(frame.rgba))).toEqual(expected);
  // Chrome's own decoder composes the cropped frames the same way. It premultiplies internally
  // whatever it is asked, so semi-transparent colours come back rounded: compare premultiplied.
  const premultiplied = frame => frame.map((value, i) => Math.round(i % 4 === 3 ? value : value * frame[i - i % 4 + 3] / 255));
  const decoded = await decodeApngFrames(context, serviceWorker, animation.filename);
  expect(decoded.length).toBe(expected.length);
  decoded.forEach((frame, i) => {
    const want = premultiplied(expected[i]);
    const got = premultiplied(frame);
    const off = got.findIndex((value, at) => Math.abs(value - want[at]) > 1);
    const pixel = off - off % 4;
    expect(off, `frame ${i + 1}, byte ${off}: got ${got.slice(pixel, pixel + 4)}, want ${want.slice(pixel, pixel + 4)}`).toBe(-1);
  });
  expect(errors).toEqual([]);
});

test('DL WEBM encodes VP9 through WebCodecs, each frame for its own delay', async ({ context, serviceWorker }) => {
  const errors = collectErrors(context);
  const { probeVideo } = await import('../test/helpers/probeVideo.mjs');

  const animation = await convert(context, serviceWorker, 'DL WEBM', 'video/webm');

  // The fixture's delays are 100, 100 and 150ms.
  expect(await probeVideo(animation.filename)).toEqual({ codec: 'vp9', timestamps: [0, 0.1, 0.2], duration: 0.35 });
  expect(errors).toEqual([]);
});

test('DL WEBM keeps an odd frame size and every frame of a longer PNG ugoira', async ({ context, serviceWorker }) => {
  const errors = collectErrors(context);
  await context.unrouteAll();
  await mockPixiv(context, ugoiraRoutes({ odd: true }));
  const { probeVideo } = await import('../test/helpers/probeVideo.mjs');

  const animation = await convert(context, serviceWorker, 'DL WEBM', 'video/webm');

  // Twelve frames: more than the encoder queues before add() waits for it.
  expect(await probeVideo(animation.filename)).toEqual({ codec: 'vp9', ...ODD_TIMES });
  expect(await decodeMedia(context, animation.filename, 'video/webm')).toMatchObject({ width: 37, height: 35 });
  expect(errors).toEqual([]);
});

// The odd fixture, as in e2e-firefox/downloads.test.mjs, where 16x16 is too small for Firefox's H.264 encoder.
test('DL MP4 encodes H.264 through WebCodecs, padded to an even size, each frame for its own delay', async ({ context, serviceWorker }) => {
  const errors = collectErrors(context);
  await context.unrouteAll();
  await mockPixiv(context, ugoiraRoutes({ odd: true }));
  const { probeVideo } = await import('../test/helpers/probeVideo.mjs');

  const animation = await convert(context, serviceWorker, 'DL MP4', 'video/mp4');

  expect(await probeVideo(animation.filename)).toEqual({ codec: 'avc', ...ODD_TIMES });
  expect(await decodeMedia(context, animation.filename, 'video/mp4')).toMatchObject({ width: 38, height: 36 });
  expect(errors).toEqual([]);
});

// The odd size tells the two apart: VP9 keeps 37x35, while the H.264 default would pad it to 38x36.
test('DL MP4 encodes the codec its setting names', async ({ context, serviceWorker }) => {
  const errors = collectErrors(context);
  await context.unrouteAll();
  await mockPixiv(context, ugoiraRoutes({ odd: true }));
  await seedSettings(serviceWorker, { ugoiraMP4Codec: 'vp9' });
  const { probeVideo, videoSize } = await import('../test/helpers/probeVideo.mjs');

  const animation = await convert(context, serviceWorker, 'DL MP4', 'video/mp4');

  expect((await probeVideo(animation.filename)).codec).toBe('vp9');
  expect(await videoSize(animation.filename)).toEqual({ width: 37, height: 35 });
  expect(errors).toEqual([]);
});

// H.265 encodes only on some hosts (hardware); elsewhere the encoder falls back. Skipped where it encodes.
test('the download manager names the codec a fallback chose', async ({ context, serviceWorker }) => {
  const errors = collectErrors(context);
  await context.unrouteAll();
  await mockPixiv(context, ugoiraRoutes({ odd: true }));
  await seedSettings(serviceWorker, { ugoiraMP4Codec: 'hevc' });
  const { probeVideo } = await import('../test/helpers/probeVideo.mjs');

  const animation = await convert(context, serviceWorker, 'DL MP4', 'video/mp4');
  const manager = context.pages().find(page => page.url().includes('/options_page/downloads.html'));
  const { codec } = await probeVideo(animation.filename);
  test.skip(codec === 'hevc', 'this host encodes H.265, so nothing falls back');

  expect(codec).toBe('avc');
  await expect(manager.locator('.download-task__type-tag')).toHaveText('Pixiv Ugoira MP4 · H.264 (AVC)');
  expect(errors).toEqual([]);
});

// Size is read in Node; Chromium can't decode MOV.
for (const { label, mime, extension } of [
  { label: 'DL MKV', mime: 'video/x-matroska', extension: '.mkv' },
  { label: 'DL MOV', mime: 'video/quicktime', extension: '.mov' }
]) {
  test(`${label} encodes H.264 through WebCodecs, padded to an even size, each frame for its own delay`, async ({ context, serviceWorker }) => {
    const errors = collectErrors(context);
    await context.unrouteAll();
    await mockPixiv(context, ugoiraRoutes({ odd: true }));
    const { probeVideo, videoSize } = await import('../test/helpers/probeVideo.mjs');
    await recordSaveNames(serviceWorker);

    const animation = await convert(context, serviceWorker, label, mime);

    // Playwright saves under its own ids, so the name comes from the download request.
    expect((await serviceWorker.evaluate(() => self.saveNames))[animation.id]).toBe(`10000003_rain loop${extension}`);
    expect(await probeVideo(animation.filename)).toEqual({ codec: 'avc', ...ODD_TIMES });
    expect(await videoSize(animation.filename)).toEqual({ width: 38, height: 36 });
    expect(errors).toEqual([]);
  });
}
