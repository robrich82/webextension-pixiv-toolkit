const fs = require('fs');
const path = require('path');
const { test: base, expect, chromium } = require('@playwright/test');

const EXTENSION_PATH = path.join(__dirname, '..', 'dist', 'chrome');
const FIXTURES = path.join(__dirname, '..', 'test', 'fixtures');

// 1x1 transparent PNG, served for every i.pximg.net request.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * Serve pixiv from test/fixtures instead of the network. `ajax` maps an
 * `/ajax/...` path on www.pixiv.net to a fixture file; an unmapped `/ajax/`
 * path 404s, any other www.pixiv.net page is a blank document, and every
 * other http(s) request is aborted so a test can never reach the real site.
 * `pximg` does the same for i.pximg.net paths, which otherwise get a 1x1 PNG.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{ ajax: Record<string, string>, pximg?: Record<string, string> }} routes
 */
async function mockPixiv(context, { ajax, pximg = {} }) {
  await context.route(/^https?:\/\//, route => {
    const url = new URL(route.request().url());

    if (url.hostname === 'i.pximg.net') {
      if (pximg[url.pathname]) {
        return route.fulfill({ path: path.join(FIXTURES, pximg[url.pathname]) });
      }

      return route.fulfill({ contentType: 'image/png', body: PIXEL });
    }

    if (url.hostname === 'www.pixiv.net') {
      if (ajax[url.pathname]) {
        return route.fulfill({ path: path.join(FIXTURES, ajax[url.pathname]) });
      }

      if (!url.pathname.startsWith('/ajax/')) {
        // A bare document is enough: the content script only needs the URL
        // and a <body> for its MutationObserver.
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html><head><title>pixiv</title></head><body></body></html>'
        });
      }

      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":true,"body":[]}' });
    }

    return route.abort();
  });
}

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
 * Open a work page and expand the collapsed panel the way a user would.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} url
 */
async function openPanel(context, url) {
  const page = await context.newPage();
  await page.goto(url);
  await page.locator('#ptk__new-handler').click();

  return page;
}

/**
 * Wait until every chrome.downloads item has finished and return them.
 * Playwright renames saved files to its own artifact ids and fires no
 * `download` event for chrome.downloads, so a test checks state, mime and
 * size instead. The timeout stays under the 30s test timeout so a stuck
 * download fails here, with the states in the message.
 * @param {import('@playwright/test').Worker} serviceWorker
 * @param {number} count
 */
async function waitForDownloads(serviceWorker, count) {
  const search = () => serviceWorker.evaluate(() => chrome.downloads.search({}));

  await expect.poll(async () => (await search()).map(item => item.error || item.state), { timeout: 20000 })
    .toEqual(Array(count).fill('complete'));

  return search();
}

const isExtensionWorker = worker => worker.url().startsWith('chrome-extension://');

const test = base.extend({
  context: async ({}, use) => {
    if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
      throw new Error(`No extension build at ${EXTENSION_PATH}; run \`pnpm run build\` first.`);
    }

    const context = await chromium.launchPersistentContext('', {
      // Full Chromium: the default headless shell can't load extensions.
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`
      ]
    });

    // The serviceWorker fixture reads the worker synchronously, so make sure
    // it exists before any test runs.
    if (!context.serviceWorkers().some(isExtensionWorker)) {
      await context.waitForEvent('serviceworker', isExtensionWorker);
    }

    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    await use(context.serviceWorkers().find(isExtensionWorker));
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  }
});

module.exports = { test, expect, mockPixiv, collectErrors, openPanel, waitForDownloads };
