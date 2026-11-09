import { flushPromises } from '@vue/test-utils';
import browser from '@/modules/Extension/browser';
import DownloadTaskObserver from '@/content_scripts/modules/DownloadTaskObserver';
import { fakeResource } from '../helpers/fakeResource';

// I18n has its own spec. This stand-in records the locale UIApplication
// asks for, so the specs below can assert on it.
let mockI18n;
vi.mock('@/modules/I18n', () => ({
  default: {
    i18n: vi.fn(locale => {
      mockI18n = { global: { locale }, install: app => { app.config.globalProperties.$t = key => key; } };
      return mockI18n;
    })
  }
}));

import UIApplication from '@/content_scripts/UIApplication';
import I18n from '@/modules/I18n';

describe('UIApplication', () => {
  let app;

  beforeEach(async () => {
    browser.storage.local.items = { language: 'en', guideShowed: true };
    app = await UIApplication.createApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (app.container.parentElement) {
      app.unload();
    }
  });

  test('mounts into a fixed container appended to the body', () => {
    expect(document.getElementById('__ptk-app')).toBe(app.container);
    expect(app.container.style).toMatchObject({ position: 'fixed', left: '0px', bottom: '0px' });
    expect(window.$extension).toBe(app.app);
  });

  test('starts in the stored language, falling back to the browser one', () => {
    expect(I18n.i18n).toHaveBeenLastCalledWith('en', 'en-US');
  });

  test('loadData shows the panel through the $eventBus and unload hides it', async () => {
    window.$app = { resource: fakeResource() };

    app.loadData({ url: 'https://www.pixiv.net/artworks/1', type: 'illust' });
    await flushPromises();
    expect(app.container.querySelector('.ptk__container')).not.toBeNull();

    app.app.unload();
    await flushPromises();
    expect(app.container.querySelector('.ptk__container')).toBeNull();
  });

  test('showRestricted shows the panel with the locked message in place of the download buttons', async () => {
    app.showRestricted();
    await flushPromises();

    expect(app.container.querySelector('.ptk__action__wrapper__body').textContent.trim())
      .toBe('_post_restricted.message');
  });

  test('the $eventBus shim forwards one payload and honours $off', () => {
    const listener = vi.fn();

    window.$eventBus.$on('custom', listener);
    window.$eventBus.$emit('custom', 'first', 'dropped');
    window.$eventBus.$off('custom', listener);
    window.$eventBus.$emit('custom', 'second');

    expect(listener.mock.calls).toEqual([['first']]);
  });

  test('storage changes update the settings and the UI language', async () => {
    await browser.storage.local.set({ guideShowed: false, language: 'zh_CN' });

    expect(app.app.getItem('guideShowed')).toBe(false);
    expect(mockI18n.global.locale).toBe('zh_CN');

    // 'default' falls back to the browser UI language (the fake's is en-US).
    await browser.storage.local.set({ language: 'default' });

    expect(mockI18n.global.locale).toBe('en_US');
  });

  test('unload unmounts the app (running beforeUnmount) and removes the container', () => {
    const stopObserve = vi.spyOn(DownloadTaskObserver.getObserver(), 'stopObserve');

    app.unload();

    expect(stopObserve).toHaveBeenCalled();
    expect(document.getElementById('__ptk-app')).toBeNull();
  });
});
