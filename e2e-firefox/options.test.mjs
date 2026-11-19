import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { closeAll, launch } from './firefox.mjs';

// The settings page on Firefox, whose WebCodecs answers differ from Chromium's. See docs/testing.md.

let firefox;

afterEach(async () => {
  try {
    await firefox?.close();
  } finally {
    firefox = undefined;
    await closeAll();
  }
});

/** Polls `fn` in the page until it returns something truthy. */
async function waitFor(bidi, page, fn, what) {
  for (const deadline = Date.now() + 20000; Date.now() < deadline;) {
    const value = await bidi.evaluate(page, fn);

    if (value) {
      return value;
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  throw new Error(`Timed out waiting for ${what}`);
}

test('each video format offers the codecs it holds, marks the ones Firefox can\'t encode and stores the choice', { timeout: 90000 }, async () => {
  firefox = await launch({});
  const { bidi, origin } = firefox;
  const page = await bidi.openTab(`${origin}/options_page/index.html`);

  // A fresh install opens the changelog dialog over the page.
  await waitFor(bidi, page, () => {
    const close = [...document.querySelectorAll('.v-dialog button')].find(button => button.textContent.trim() === 'Close');
    close?.click();

    return Boolean(close);
  }, 'the changelog dialog');
  await bidi.evaluate(page, () => [...document.querySelectorAll('.v-expansion-panel-title')]
    .find(title => title.textContent.trim() === 'Pixiv Ugoira').click());
  await waitFor(bidi, page, () => document.querySelector('.ugoira-codec-mp4 .v-field'), 'the MP4 codec row');

  // Each option's label, then the mark under it if any.
  const menu = await bidi.evaluate(page, async () => {
    // VSelect opens its menu on mousedown.
    document.querySelector('.ugoira-codec-mp4 .v-field').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    for (let tries = 0; tries < 100 && !document.querySelector('.v-overlay--active .v-list-item'); tries++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return [...document.querySelectorAll('.v-overlay--active .v-list-item')].map(item => [
      item.querySelector('.v-list-item-title').textContent.trim(),
      item.querySelector('.v-list-item-subtitle')?.textContent.trim() ?? ''
    ]);
  });

  assert.deepEqual(menu.map(([title]) => title), ['H.264 (AVC)', 'VP9', 'AV1', 'H.265 (HEVC)', 'VP8']);
  // Firefox 130+ encodes these, so marking one would mean its codec string is wrong.
  assert.deepEqual(menu.filter(([title, mark]) => title !== 'H.265 (HEVC)' && mark), []);

  await bidi.evaluate(page, () => [...document.querySelectorAll('.v-overlay--active .v-list-item')]
    .find(item => item.textContent.includes('VP9')).click());
  const stored = await waitFor(bidi, page, () => browser.storage.local.get(['ugoiraMP4Codec', 'ugoiraMOVCodec'])
    .then(items => items.ugoiraMP4Codec === 'vp9' && items), 'the stored codec');

  assert.deepEqual(stored, { ugoiraMP4Codec: 'vp9', ugoiraMOVCodec: 'avc' });
  assert.deepEqual(firefox.errors, []);
});
