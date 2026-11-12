const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, '..', 'test', 'fixtures');
const PIXIV_HOSTS = ['www.pixiv.net', 'i.pximg.net'];
// 1x1 transparent PNG, served for every unmapped i.pximg.net path.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
// A bare document is enough: the content script only needs the URL and a <body> for its MutationObserver.
const BLANK_PAGE = '<!doctype html><html><head><title>pixiv</title></head><body></body></html>';
const CONTENT_TYPES = {
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};

const fixture = name => ({
  status: 200,
  contentType: CONTENT_TYPES[path.extname(name)] || 'application/octet-stream',
  body: fs.readFileSync(path.join(FIXTURES, name))
});

/**
 * The fake pixiv that both e2e suites run against. Each runner only adapts the
 * response: `route.fulfill` for Chromium (e2e/fixtures.js), the HTTPS proxy for
 * Firefox (e2e-firefox/fakePixiv.mjs).
 *
 * `ajax` maps an `/ajax/...` path on www.pixiv.net to a file in test/fixtures; an
 * unmapped `/ajax/` path 404s, and any other www.pixiv.net page is a blank
 * document. `pximg` does the same for i.pximg.net paths, which otherwise get a
 * 1x1 PNG; a value can also be an inline `{ contentType, body }`.
 *
 * @param {URL} url
 * @param {{ ajax: Record<string, string>, pximg?: Record<string, string|{ contentType: string, body: Buffer }> }} routes
 * @returns {{ status: number, contentType: string, body: Buffer|string }|null} null for any other host, which the runner refuses
 */
function pixivResponse(url, { ajax, pximg = {} }) {
  if (url.hostname === 'i.pximg.net') {
    const route = pximg[url.pathname];

    if (typeof route === 'string') {
      return fixture(route);
    }

    return route ? { status: 200, ...route } : { status: 200, contentType: 'image/png', body: PIXEL };
  }

  if (url.hostname === 'www.pixiv.net') {
    if (ajax[url.pathname]) {
      return fixture(ajax[url.pathname]);
    }

    if (!url.pathname.startsWith('/ajax/')) {
      return { status: 200, contentType: 'text/html', body: BLANK_PAGE };
    }

    return { status: 404, contentType: 'application/json', body: '{"error":true,"body":[]}' };
  }

  return null;
}

module.exports = { PIXIV_HOSTS, PIXEL, pixivResponse };
