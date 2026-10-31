const { test, expect, mockPixiv } = require('./fixtures');

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
 * Collect uncaught errors from every page in the context, the download
 * manager tab included.
 * @param {import('@playwright/test').BrowserContext} context
 */
function collectErrors(context) {
  const errors = [];
  context.on('weberror', webError => errors.push(webError.error()));

  return errors;
}

/**
 * Open the illust page and expand the collapsed panel the way a user would.
 * @param {import('@playwright/test').BrowserContext} context
 */
async function openPanel(context) {
  const page = await context.newPage();
  await page.goto(ILLUST_URL);
  await page.locator('#ptk__new-handler').click();

  const downloadButton = page.getByText('Download', { exact: true });
  await expect(downloadButton).toBeInViewport();

  return { page, downloadButton };
}

test('injects the download panel on an illust page', async ({ context }) => {
  const errors = collectErrors(context);

  await openPanel(context);

  expect(errors).toEqual([]);
});

test('removes the panel when pixiv navigates to a page it has no adapter for', async ({ context }) => {
  const { page } = await openPanel(context);

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
  const { downloadButton } = await openPanel(context);

  await Promise.all([
    context.waitForEvent('page', p => p.url().includes('/options_page/downloads.html')),
    context.waitForEvent('request', request =>
      request.url() === 'https://i.pximg.net/img-original/img/2024/03/07/10/20/30/10000001_p0.jpg'),
    downloadButton.click()
  ]);

  // Playwright renames saved files to its own artifact ids and fires no
  // `download` event for chrome.downloads, so only the state is checkable here.
  await expect.poll(() => serviceWorker.evaluate(async () => {
    const items = await chrome.downloads.search({});
    return items.map(item => item.error || item.state);
  }), { timeout: 15000 }).toEqual(['complete']);
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
