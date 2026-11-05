import { flushPromises } from '@vue/test-utils';
import browser from '@/modules/Extension/browser';

// Same stand-in as UIApplication.spec.js: vue-i18n's ESM build doesn't load
// under Jest.
jest.mock('@/modules/I18n', () => ({
  i18n: jest.fn(locale => ({
    global: { locale },
    install: app => { app.config.globalProperties.$t = key => key; }
  }))
}));

// webpack's DefinePlugin constant, read by '@/core/global' at import time.
globalThis.PRESET_BROWSER = 'chrome';

const { default: Application } = require('@/content_scripts/Application');
const article = require('../fixtures/fanbox/post-article.json');
const restrictedPost = require('../fixtures/fanbox/post-restricted.json');

const articleUrl = 'https://www.fanbox.cc/@sketchbook/posts/60000001';
const restrictedUrl = 'https://www.fanbox.cc/@sketchbook/posts/60000003';

const clone = fixture => JSON.parse(JSON.stringify(fixture));

/**
 * Drives the real path from a url change to the panel: PageFilter, the fanbox
 * adapter and PostParser, then UIApplication and App.vue. Only the background
 * worker's `fanbox:postInfo` answer is canned.
 */
describe('Application on a fanbox post', () => {
  let application;
  let consoleError;

  const postInfoReplies = { 60000001: article, 60000003: restrictedPost };

  const visit = async url => {
    await application.urlchangeHandler(url, null);
    await flushPromises();
  };

  const buttons = () => [...document.querySelectorAll('#__ptk-app .ptk__action__wrapper__body > a')]
    .map(a => a.textContent.trim());
  const sent = action => browser.runtime.sendMessage.mock.calls.filter(([message]) => message.action === action);

  beforeEach(async () => {
    browser.storage.local.items = { guideShowed: true };
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'fanbox:postInfo') {
        sendResponse(clone(postInfoReplies[message.args.postId]));
      }
    });

    // The constructor parses jsdom's own url, which no filter matches.
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    window.$app = application = new Application();
    await flushPromises();
    consoleError.mockClear();
    browser.runtime.sendMessage.mockClear();
  });

  afterEach(() => {
    application.UIApp && application.UIApp.unload();
    jest.restoreAllMocks();
  });

  test('a post it can read shows the download button', async () => {
    await visit(articleUrl);

    expect(buttons()).toEqual(['_download.message']);
    expect(sent('badge:activeIcon')).toHaveLength(1);
  });

  test('a restricted post keeps the panel up with the locked message instead (#204)', async () => {
    await visit(restrictedUrl);

    expect(buttons()).toEqual(['_post_restricted.message']);
    expect(application.resource).toBeNull();
    expect(sent('badge:deactiveAction')).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('moving from a readable post to a restricted one swaps the button for the message', async () => {
    await visit(articleUrl);
    await visit(restrictedUrl);

    expect(buttons()).toEqual(['_post_restricted.message']);
  });

  test('moving from a restricted post to a readable one brings the download button back', async () => {
    await visit(restrictedUrl);
    await visit(articleUrl);

    expect(buttons()).toEqual(['_download.message']);
  });

  test('any other failure still takes the panel down and logs the error', async () => {
    await visit(restrictedUrl);
    await visit('https://www.fanbox.cc/@sketchbook');

    expect(document.getElementById('__ptk-app')).toBeNull();
    expect(application.UIApp).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ name: 'RuntimeError' }));
  });
});
