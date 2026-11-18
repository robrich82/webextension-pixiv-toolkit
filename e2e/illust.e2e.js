const fs = require('fs');
const JSZip = require('jszip');
const {
  test, expect, mockPixiv, collectErrors, openPanel, recordSaveNames, savedFiles
} = require('./fixtures');
const { PIXEL } = require('./fakePixivRoutes');

const ILLUST_URL = 'https://www.pixiv.net/en/artworks/10000001';
const ORIGINAL = '/img-original/img/2024/03/07/10/20/30/10000001_p0.jpg';
// The page's bytes end with a marker, so the zipped entry can be matched to it.
const PAGE_BODY = Buffer.concat([PIXEL, Buffer.from('page 0')]);

test.beforeEach(async ({ context }) => {
  await mockPixiv(context, {
    ajax: {
      '/ajax/illust/10000001': 'pixiv/illust-single.json',
      '/ajax/illust/10000001/pages': 'pixiv/illust-single-pages.json'
    },
    pximg: { [ORIGINAL]: { contentType: 'image/png', body: PAGE_BODY } }
  });
});

/**
 * @param {import('@playwright/test').BrowserContext} context
 */
async function openIllustPanel(context) {
  const page = await openPanel(context, ILLUST_URL);
  const downloadButton = page.getByText('Download', { exact: true });
  await expect(downloadButton).toBeInViewport();

  return { page, downloadButton };
}

test('injects the download panel on an illust page', async ({ context }) => {
  const errors = collectErrors(context);

  await openIllustPanel(context);

  expect(errors).toEqual([]);
});

test('removes the panel when pixiv navigates to a page it has no adapter for', async ({ context }) => {
  const { page } = await openIllustPanel(context);

  // pixiv is a SPA: the URL changes without a load, and the content script
  // notices on the next DOM mutation.
  await page.evaluate(() => {
    history.pushState(null, '', '/en/');
    document.body.appendChild(document.createElement('div'));
  });

  await expect(page.locator('#__ptk-app')).toHaveCount(0);
});

test('download opens the download manager and saves the image in a zip', async ({ context, serviceWorker }) => {
  const errors = collectErrors(context);
  await recordSaveNames(serviceWorker);
  const { downloadButton } = await openIllustPanel(context);

  await Promise.all([
    context.waitForEvent('page', p => p.url().includes('/options_page/downloads.html')),
    context.waitForEvent('request', request => request.url() === `https://i.pximg.net${ORIGINAL}`),
    downloadButton.click()
  ]);

  const [file] = await savedFiles(serviceWorker, 1);
  expect(file.name).toBe('10000001_harbour at dusk.zip');
  const zip = await JSZip.loadAsync(fs.readFileSync(file.path));
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  expect(entries).toHaveLength(1);
  expect(await entries[0].async('nodebuffer')).toEqual(PAGE_BODY);
  expect(errors).toEqual([]);
});

// #391: the page was observing before the download manager existed.
test("the Download button follows the task the download manager opened for", async ({ context }) => {
  const { page } = await openIllustPanel(context);

  await page.getByText('Download', { exact: true }).click();

  await expect(page.getByText('Download ✔', { exact: true })).toBeVisible({ timeout: 20000 });
});

for (const entry of ['options_page/index.html', 'popup_page/index.html']) {
  test(`${entry} mounts without errors`, async ({ context, extensionId }) => {
    const errors = collectErrors(context);
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/${entry}`);

    await expect(page.locator('#app-mount > *').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}
