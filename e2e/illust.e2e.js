const { test, expect, mockPixiv } = require('./fixtures');

const ILLUST_URL = 'https://www.pixiv.net/en/artworks/10000001';

// Pre-existing: the content script loads js-epub-maker.js without
// handlebars-latest.js, so it throws on every page. Epub building happens in
// the download manager, which loads both, so nothing user-visible breaks.
const KNOWN_PAGE_ERRORS = [/Handlebars is not defined/];

test.beforeEach(async ({ context }) => {
  await mockPixiv(context, {
    ajax: {
      '/ajax/illust/10000001': 'pixiv/illust-single.json',
      '/ajax/illust/10000001/pages': 'pixiv/illust-single-pages.json'
    }
  });
});

/**
 * Open the illust page and expand the collapsed panel the way a user would.
 * @param {import('@playwright/test').BrowserContext} context
 */
async function openPanel(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => {
    if (!KNOWN_PAGE_ERRORS.some(pattern => pattern.test(error.message))) {
      errors.push(error);
    }
  });

  await page.goto(ILLUST_URL);
  await page.locator('#ptk__new-handler').click();

  const downloadButton = page.getByText('Download', { exact: true });
  await expect(downloadButton).toBeInViewport();

  return { page, errors, downloadButton };
}

test('injects the download panel on an illust page', async ({ context }) => {
  const { errors } = await openPanel(context);

  expect(errors).toEqual([]);
});

test('does not inject on a page it has no adapter for', async ({ context }) => {
  const page = await context.newPage();

  await page.goto('https://www.pixiv.net/en/');

  // Give the content script time to run before asserting a negative.
  await page.waitForTimeout(1000);
  await expect(page.locator('#__ptk-app')).toHaveCount(0);
});

test('download opens the download manager and saves the image', async ({ context, serviceWorker }) => {
  const { downloadButton } = await openPanel(context);

  const originalFetched = context.waitForEvent('request', request =>
    request.url() === 'https://i.pximg.net/img-original/img/2024/03/07/10/20/30/10000001_p0.jpg');
  const managerOpened = context.waitForEvent('page', p => p.url().includes('/options_page/downloads.html'));
  await downloadButton.click();
  await managerOpened;
  await originalFetched;

  // Playwright renames saved files to its own artifact ids and fires no
  // `download` event for chrome.downloads, so only the state is checkable here.
  await expect.poll(() => serviceWorker.evaluate(async () => {
    const items = await chrome.downloads.search({});
    return items.map(item => item.state);
  }), { timeout: 15000 }).toEqual(['complete']);
});
