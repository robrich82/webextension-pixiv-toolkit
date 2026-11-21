import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { closeAll, launch, poll } from './firefox.mjs';

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

test("each video format offers the codecs it holds, marks the ones Firefox can't encode and stores the choice", { timeout: 90000 }, async () => {
  firefox = await launch({});
  const { bidi, origin } = firefox;
  const page = await bidi.openTab(`${origin}/options_page/index.html`);
  const inPage = (fn, what) => poll(() => bidi.evaluate(page, fn), what);

  // A fresh install opens the changelog dialog over the page.
  await inPage(() => {
    const close = [...document.querySelectorAll('.v-dialog button')].find(button => button.textContent.trim() === 'Close');
    close?.click();

    return Boolean(close);
  }, 'the changelog dialog');
  // The settings can render after the dialog does.
  await inPage(() => {
    const panel = [...document.querySelectorAll('.v-expansion-panel-title')].find(title => title.textContent.trim() === 'Pixiv Ugoira');
    panel?.click();

    return Boolean(panel);
  }, 'the Pixiv Ugoira settings panel');
  // The rows load until WebCodecs answers, and only then mark anything.
  await inPage(() => document.querySelector('.ugoira-codec-mp4 .v-field')
    && !document.querySelector('[class*="ugoira-codec-"] .v-field--loading'), 'WebCodecs to answer');

  // VSelect opens its menu on mousedown.
  await bidi.evaluate(page, () => document.querySelector('.ugoira-codec-mp4 .v-field')
    .dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  // Each option's label, then the mark under it if any.
  const menu = await inPage(() => {
    const items = [...document.querySelectorAll('.v-overlay--active .v-list-item')];

    return items.length && items.map(item => [
      item.querySelector('.v-list-item-title').textContent.trim(),
      item.querySelector('.v-list-item-subtitle')?.textContent.trim() ?? ''
    ]);
  }, 'the MP4 codec menu');
  const hevc = await bidi.evaluate(page, () => VideoEncoder.isConfigSupported({ codec: 'hvc1.1.6.L120.B0', width: 1920, height: 1080 })
    .then(support => support.supported));

  const unencodable = "This browser can't encode it";
  assert.deepEqual(menu, [
    // Firefox reports these encodable, so marking one would mean its codec string is wrong.
    ['H.264 (AVC)', ''], ['VP9', ''], ['AV1', ''],
    // H.265 depends on the platform: the mark follows Firefox's answer.
    ['H.265 (HEVC)', hevc ? '' : unencodable],
    ['VP8', '']
  ]);

  await bidi.evaluate(page, () => [...document.querySelectorAll('.v-overlay--active .v-list-item')]
    .find(item => item.textContent.includes('VP9')).click());
  const stored = await inPage(() => browser.storage.local.get(['ugoiraMP4Codec', 'ugoiraMOVCodec'])
    .then(items => items.ugoiraMP4Codec === 'vp9' && items), 'the stored codec');

  assert.deepEqual(stored, { ugoiraMP4Codec: 'vp9', ugoiraMOVCodec: 'avc' });
  assert.deepEqual(firefox.errors, []);
});
