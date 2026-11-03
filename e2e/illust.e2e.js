const { test, expect, mockPixiv, collectErrors, openPanel, waitForDownloads } = require('./fixtures');

const ILLUST_URL = 'https://www.pixiv.net/en/artworks/10000001';

test.beforeEach(async ({ context }) => {
  await mockPixiv(context, {
    ajax: {
      '/ajax/illust/10000001': 'pixiv/illust-single.json',
      '/ajax/illust/10000001/pages': 'pixiv/illust-single-pages.json'
    }
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

test('download opens the download manager and saves the image', async ({ context, serviceWorker }) => {
  const errors = collectErrors(context);
  const { downloadButton } = await openIllustPanel(context);

  await Promise.all([
    context.waitForEvent('page', p => p.url().includes('/options_page/downloads.html')),
    context.waitForEvent('request', request =>
      request.url() === 'https://i.pximg.net/img-original/img/2024/03/07/10/20/30/10000001_p0.jpg'),
    downloadButton.click()
  ]);

  await waitForDownloads(serviceWorker, 1);
  expect(errors).toEqual([]);
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
