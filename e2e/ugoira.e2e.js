const {
  test, expect, mockPixiv, collectErrors, openPanel, waitForDownloads, seedSettings, decodeMedia
} = require('./fixtures');

const UGOIRA_URL = 'https://www.pixiv.net/en/artworks/10000003';
// test/fixtures/pixiv/illust-ugoira-frames.zip: three 16x16 frames, 350ms in all.
const FRAME_SIZE = { width: 16, height: 16 };

test.beforeEach(async ({ context }) => {
  await mockPixiv(context, {
    ajax: {
      '/ajax/illust/10000003': 'pixiv/illust-ugoira.json',
      '/ajax/illust/10000003/ugoira_meta': 'pixiv/illust-ugoira-meta.json'
    },
    pximg: {
      '/img-zip-ugoira/img/2024/06/01/08/00/00/10000003_ugoira1920x1080.zip': 'pixiv/illust-ugoira-frames.zip'
    }
  });
});

/**
 * Click a format button and wait for the frames zip and the animation.
 * @returns {Promise<chrome.downloads.DownloadItem>} The animation
 */
async function convert(context, serviceWorker, label, mime) {
  const page = await openPanel(context, UGOIRA_URL);

  await page.getByText(label, { exact: true }).click();

  // The zip is saved as soon as it arrives; the animation follows once
  // ffmpeg.wasm has converted the frames.
  const items = await waitForDownloads(serviceWorker, 2);
  expect(items.map(item => item.mime).sort()).toEqual(['application/zip', mime].sort());
  expect(items.every(item => item.fileSize > 0)).toBe(true);

  return items.find(item => item.mime === mime);
}

const formats = [
  { label: 'DL GIF', mime: 'image/gif' },
  { label: 'DL APNG', mime: 'image/apng' },
  { label: 'DL WEBM', mime: 'video/webm' },
  // `-c copy` stores the JPEG frames as an MJPEG stream, which browsers don't play.
  { label: 'DL MP4', mime: 'video/mp4', decodes: false }
];

for (const { label, mime, decodes = true } of formats) {
  test(`${label} saves the frames zip and the converted animation`, async ({ context, serviceWorker }) => {
    const errors = collectErrors(context);

    const animation = await convert(context, serviceWorker, label, mime);

    if (!decodes) {
      expect(errors).toEqual([]);
      return;
    }

    const decoded = await decodeMedia(context, animation.filename, mime);
    expect(decoded).toMatchObject(FRAME_SIZE);
    if (mime.startsWith('video/')) {
      expect(decoded.duration).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  });
}

test('DL Custom runs the custom FFmpeg command and saves its output', async ({ context, serviceWorker }) => {
  const errors = collectErrors(context);
  // The last argument names the output, and so the saved file's type.
  await seedSettings(serviceWorker, {
    ugoiraCustomFFmpegCommand: '-f concat -i input.txt -vf scale=8:4 -plays 0 custom.gif'
  });

  const animation = await convert(context, serviceWorker, 'DL Custom', 'image/gif');

  expect(await decodeMedia(context, animation.filename, 'image/gif')).toEqual({ width: 8, height: 4 });
  expect(errors).toEqual([]);
});
