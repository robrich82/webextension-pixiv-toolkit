const fs = require('fs');
const JSZip = require('jszip');
const {
  test, expect, mockPixiv, collectErrors, openPanel, waitForDownloads, decodeMedia,
  recordSaveNames, savedFiles
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
