const { test, expect, mockPixiv, collectErrors, openPanel, waitForDownloads } = require('./fixtures');

const UGOIRA_URL = 'https://www.pixiv.net/en/artworks/10000003';

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

const formats = [
  { label: 'DL GIF', mime: 'image/gif' },
  { label: 'DL APNG', mime: 'image/apng' },
  { label: 'DL WEBM', mime: 'video/webm' },
  { label: 'DL MP4', mime: 'video/mp4' }
];

for (const { label, mime } of formats) {
  test(`${label} saves the frames zip and the converted animation`, async ({ context, serviceWorker }) => {
    const errors = collectErrors(context);
    const page = await openPanel(context, UGOIRA_URL);

    await page.getByText(label, { exact: true }).click();

    // The zip is saved as soon as it arrives; the animation follows once
    // ffmpeg.wasm has converted the frames.
    const items = await waitForDownloads(serviceWorker, 2);
    expect(items.map(item => item.mime).sort()).toEqual(['application/zip', mime].sort());
    expect(items.every(item => item.fileSize > 0)).toBe(true);
    expect(errors).toEqual([]);
  });
}
