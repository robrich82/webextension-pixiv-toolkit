const fs = require('fs');
const os = require('os');
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

// Each setup step's own limit, well under the 30s test timeout, so a hang names its step (#400).
const SETUP_TIMEOUT = 10000;

/**
 * The extension's service worker, waiting for it to start if it hasn't yet.
 * @param {import('@playwright/test').BrowserContext} context
 */
async function extensionWorker(context) {
  const started = Date.now();
  // Listen before looking, so a worker that registers in between isn't missed.
  const registered = context.waitForEvent('serviceworker', { predicate: isExtensionWorker, timeout: SETUP_TIMEOUT });
  const running = context.serviceWorkers().find(isExtensionWorker);

  if (running) {
    registered.catch(() => {});

    return running;
  }

  try {
    return await registered;
  } catch (error) {
    throw new Error(`the extension's service worker never started (waited ${Date.now() - started}ms)`, { cause: error });
  }
}

const test = base.extend({
  // Chromium writes its indexed ruleset into the unpacked extension's _metadata on load. Workers sharing one
  // build race on it, and the loser runs without the extension (#400), so each worker loads its own copy.
  extensionPath: [async ({}, use) => {
    if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
      throw new Error(`No extension build at ${EXTENSION_PATH}; run \`pnpm run build\` first.`);
    }

    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-e2e-extension-'));
    fs.cpSync(EXTENSION_PATH, copy, {
      recursive: true,
      filter: source => path.relative(EXTENSION_PATH, source) !== '_metadata'
    });

    await use(copy);
    fs.rmSync(copy, { recursive: true, force: true });
  }, { scope: 'worker' }],

  context: async ({ extensionPath }, use) => {
    const context = await chromium.launchPersistentContext('', {
      // Full Chromium: the default headless shell can't load extensions.
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });

    // The serviceWorker fixture reads the worker synchronously, so make sure
    // it exists before any test runs.
    const worker = await extensionWorker(context);

    // The fresh install writes the default settings asynchronously (stamping
    // `version`). A page opened before then misses them, and they can land on
    // top of settings a test seeds (#241).
    await expect.poll(() => worker.evaluate(() =>
      chrome.storage.local.get('version').then(items => items.version)
    ), { message: 'the install never wrote the default settings', timeout: SETUP_TIMEOUT }).toBeTruthy();

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
