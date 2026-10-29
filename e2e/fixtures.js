const path = require('path');
const { test: base, chromium } = require('@playwright/test');

const EXTENSION_PATH = path.join(__dirname, '..', 'dist', 'chrome');
const FIXTURES = path.join(__dirname, '..', 'test', 'fixtures');

// 1x1 transparent PNG, served for every pximg.net image request.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * Serve pixiv from test/fixtures instead of the network. `ajax` maps an
 * `/ajax/...` path to a fixture file; anything unmapped on a pixiv host 404s,
 * and every other http(s) request is aborted so a test can never reach the
 * real site.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{ ajax?: Record<string, string> }} routes
 */
async function mockPixiv(context, { ajax = {} } = {}) {
  await context.route(/^https?:\/\//, route => {
    const url = new URL(route.request().url());

    if (url.hostname === 'i.pximg.net') {
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

const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      // The bundled Chromium, not branded Chrome, which ignores --load-extension.
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`
      ]
    });

    // Don't navigate before the extension has loaded, or the first page can
    // race its content script registration.
    if (!context.serviceWorkers().length) {
      await context.waitForEvent('serviceworker');
    }

    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    await use(context.serviceWorkers()[0]);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  }
});

module.exports = { test, expect: test.expect, mockPixiv };
