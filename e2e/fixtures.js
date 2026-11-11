const fs = require('fs');
const path = require('path');
const { test: base, expect, chromium } = require('@playwright/test');
const { pixivResponse } = require('./fakePixivRoutes');

const EXTENSION_PATH = path.join(__dirname, '..', 'dist', 'chrome');

/**
 * Serve pixiv from test/fixtures instead of the network, routed by
 * fakePixivRoutes.js. Every other http(s) request is aborted, so a test can
 * never reach the real site.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {Parameters<typeof pixivResponse>[1]} routes
 */
async function mockPixiv(context, routes) {
  await context.route(/^https?:\/\//, route => {
    const response = pixivResponse(new URL(route.request().url()), routes);

    return response ? route.fulfill(response) : route.abort();
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

/**
 * Write settings the way the options page does. Pages opened afterwards read them.
 * @param {import('@playwright/test').Worker} serviceWorker
 * @param {object} settings
 */
async function seedSettings(serviceWorker, settings) {
  await serviceWorker.evaluate(items => chrome.storage.local.set(items), settings);
}

/**
 * Remember the filename each chrome.downloads.download asks for. Playwright
 * saves files under its own ids, so a download item doesn't carry it. Lost if
 * the service worker restarts, so call it just before the download.
 * @param {import('@playwright/test').Worker} serviceWorker
 */
async function recordSaveNames(serviceWorker) {
  await serviceWorker.evaluate(() => {
    self.saveNames = {};
    const download = chrome.downloads.download.bind(chrome.downloads);

    chrome.downloads.download = (options, callback) => download(options, downloadId => {
      self.saveNames[downloadId] = options.filename;
      callback?.(downloadId);
    });
  });
}

/**
 * The finished downloads with the filename each asked for (see recordSaveNames), oldest first.
 * @param {import('@playwright/test').Worker} serviceWorker
 * @param {number} count
 */
async function savedFiles(serviceWorker, count) {
  const items = await waitForDownloads(serviceWorker, count);
  const names = await serviceWorker.evaluate(() => self.saveNames);

  return items
    .sort((a, b) => a.id - b.id)
    .map(item => ({ name: names[item.id], path: item.filename, mime: item.mime }));
}

/**
 * Decode a saved image or video in a page and report what the browser read:
 * dimensions, plus duration for a video. Rejects if it can't be decoded.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} file
 * @param {string} mime
 */
async function decodeMedia(context, file, mime) {
  const page = await context.newPage();
  await page.goto('about:blank');

  try {
    return await page.evaluate(async ({ base64, mime }) => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));

      if (mime.startsWith('image/')) {
        const image = new Image();
        image.src = url;
        await image.decode();

        return { width: image.naturalWidth, height: image.naturalHeight };
      }

      const video = document.createElement('video');
      video.muted = true;
      video.src = url;
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = () => reject(new Error(`Can't decode ${mime}: ${video.error?.message}`));
      });

      return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
    }, { base64: fs.readFileSync(file).toString('base64'), mime });
  } finally {
    await page.close();
  }
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

    // The fresh install writes the default settings asynchronously (stamping
    // `version`). A page opened before then misses them, and they can land on
    // top of settings a test seeds (#241).
    const worker = context.serviceWorkers().find(isExtensionWorker);
    await expect.poll(() => worker.evaluate(() =>
      chrome.storage.local.get('version').then(items => items.version)
    ), { message: 'the install never wrote the default settings' }).toBeTruthy();

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

module.exports = {
  test, expect, mockPixiv, collectErrors, openPanel, waitForDownloads,
  seedSettings, recordSaveNames, savedFiles, decodeMedia
};
