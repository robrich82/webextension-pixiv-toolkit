const fs = require('fs');
const JSZip = require('jszip');
const {
  test, expect, mockPixiv, collectErrors, openPanel, waitForDownloads, decodeMedia,
  recordSaveNames, savedFiles
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

/** The ugoira's routes, with `odd` serving the twelve 37x35 PNG frames instead. */
const ugoiraRoutes = ({ odd = false } = {}) => ({
  ajax: {
    '/ajax/illust/10000003': 'pixiv/illust-ugoira.json',
    '/ajax/illust/10000003/ugoira_meta': odd ? 'pixiv/illust-ugoira-meta-odd.json' : 'pixiv/illust-ugoira-meta.json'
  },
  pximg: {
    '/img-zip-ugoira/img/2024/06/01/08/00/00/10000003_ugoira1920x1080.zip':
      odd ? 'pixiv/illust-ugoira-frames-odd.zip' : 'pixiv/illust-ugoira-frames.zip'
  }
});

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
