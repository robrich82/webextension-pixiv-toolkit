import { flushPromises } from '@vue/test-utils';
import browser from '@/modules/Extension/browser';
import Detector from '@/content_scripts/modules/Detector';
import Application from '@/content_scripts/Application';
import article from '../fixtures/fanbox/post-article.json';
import restrictedPost from '../fixtures/fanbox/post-restricted.json';

const articleUrl = 'https://www.fanbox.cc/@sketchbook/posts/60000001';
const restrictedUrl = 'https://www.fanbox.cc/@sketchbook/posts/60000003';
const creatorUrl = 'https://www.fanbox.cc/@sketchbook';

const clone = fixture => JSON.parse(JSON.stringify(fixture));

/**
 * Drives the real path from a url change to the panel: PageFilter, the fanbox
 * adapter and PostParser, then UIApplication and App.vue. Only the background
 * worker's `fanbox:postInfo` answer is canned.
 */
describe('Application on a fanbox post', () => {
  let application;
  let consoleError;
  let consoleWarn;
  let slowPosts;

  const postInfoReplies = { 60000001: article, 60000003: restrictedPost };

  const visit = async url => {
    await application.urlchangeHandler(url, null);
    await flushPromises();
  };

  // Starts a visit whose post.info reply waits until the returned function
  // releases it.
  const visitSlowly = url => {
    const postId = url.split('/').pop();
    let release;

    slowPosts.set(postId, reply => { release = reply; });

    const visiting = application.urlchangeHandler(url, null);

    return async () => {
      await flushPromises();
      release();
      await visiting;
      await flushPromises();
    };
  };

  const buttons = () => [...document.querySelectorAll('#__ptk-app .ptk__action__wrapper__body > a')]
    .map(a => a.textContent.trim());
  const sent = action => browser.runtime.sendMessage.mock.calls.filter(([message]) => message.action === action);

  beforeEach(async () => {
    slowPosts = new Map();
    browser.storage.local.items = { guideShowed: true };
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'fanbox:postInfo') {
        const reply = () => sendResponse(clone(postInfoReplies[message.args.postId]));

        if (slowPosts.has(message.args.postId)) {
          slowPosts.get(message.args.postId)(reply);
          return true;
        }

        reply();
      }
    });

    // The tests drive urlchangeHandler directly; a live MutationObserver per
    // test would outlive it.
    vi.spyOn(Detector.prototype, 'observeUrl').mockImplementation(() => {});
    // The constructor parses jsdom's own url, which no filter matches.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.$app = application = new Application();
    await flushPromises();
    consoleError.mockClear();
    browser.runtime.sendMessage.mockClear();
  });

  afterEach(() => {
    application.UIApp && application.UIApp.unload();
    document.querySelectorAll('#__ptk-app').forEach(container => container.remove());
    vi.restoreAllMocks();
  });

  test('a post it can read shows the download button', async () => {
    await visit(articleUrl);

    expect(buttons()).toEqual(['_download.message']);
    expect(sent('badge:activeIcon')).toHaveLength(1);
  });

  test('a restricted post keeps the panel up with the locked message instead (#204)', async () => {
    await visit(restrictedUrl);

    expect(buttons()).toEqual(['_post_restricted.message']);
    expect(sent('badge:deactiveAction')).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith('Fanbox post 60000003 is restricted for this account');
  });

  test('moving from a readable post to a restricted one swaps the button for the message', async () => {
    await visit(articleUrl);
    await visit(restrictedUrl);

    expect(buttons()).toEqual(['_post_restricted.message']);
    // Bootstrap answers the popup's fetch-info from this.
    expect(application.resource).toBeNull();
  });

  test('moving from a restricted post to a readable one brings the download button back', async () => {
    await visit(restrictedUrl);
    await visit(articleUrl);

    expect(buttons()).toEqual(['_download.message']);
  });

  test('any other failure still takes the panel down and logs the error', async () => {
    await visit(restrictedUrl);
    await visit(creatorUrl);

    expect(document.getElementById('__ptk-app')).toBeNull();
    expect(application.UIApp).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ name: 'RuntimeError' }));
  });

  test("a late reply for a restricted post the user left doesn't replace the readable one", async () => {
    const releaseRestricted = visitSlowly(restrictedUrl);

    await visit(articleUrl);
    await releaseRestricted();

    expect(buttons()).toEqual(['_download.message']);
    expect(application.resource).not.toBeNull();
  });

  test("a late restricted reply doesn't put the panel back on a page with no post", async () => {
    const releaseRestricted = visitSlowly(restrictedUrl);

    await visit(creatorUrl);
    await releaseRestricted();

    expect(document.getElementById('__ptk-app')).toBeNull();
    expect(application.UIApp).toBeFalsy();
  });

  test("a late reply for a readable post the user left doesn't replace the restricted one", async () => {
    const releaseArticle = visitSlowly(articleUrl);

    await visit(restrictedUrl);
    await releaseArticle();

    expect(buttons()).toEqual(['_post_restricted.message']);
    expect(application.resource).toBeNull();
  });
});
