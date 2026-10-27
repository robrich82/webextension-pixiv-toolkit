import browser from '@/modules/Extension/browser';
import { flushPromises } from '@vue/test-utils';
import DownloadTaskObserver from '@/content_scripts/modules/DownloadTaskObserver';
import { fakeResource } from '../helpers/fakeResource';

// vue-i18n resolves to its ESM browser build under jsdom, which Jest can't
// load; I18n has its own spec, so a stand-in exposing `global.locale` will do.
let mockI18n;
jest.mock('@/modules/I18n', () => ({
  i18n: locale => {
    mockI18n = { global: { locale }, install: app => { app.config.globalProperties.$t = key => key; } };
    return mockI18n;
  }
}));

// webpack's DefinePlugin constant, read by '@/core/global' at import time.
globalThis.PRESET_BROWSER = 'chrome';

const { default: UIApplication } = require('@/content_scripts/UIApplication');

describe('UIApplication', () => {
  let app;

  beforeEach(async () => {
    browser.storage.local.items = { language: 'en', guideShowed: true };
    app = await UIApplication.createApp();
  });

  afterEach(() => {
    jest.restoreAllMocks();

    if (app.container.parentElement) {
      app.unload();
    }
  });

  test('mounts into a fixed container appended to the body', () => {
    expect(document.getElementById('__ptk-app')).toBe(app.container);
    expect(window.$extension).toBe(app.app);
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

  test('the $eventBus shim forwards one payload and honours $off', () => {
    const listener = jest.fn();

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
    const stopObserve = jest.spyOn(DownloadTaskObserver.getObserver(), 'stopObserve');

    app.unload();

    expect(stopObserve).toHaveBeenCalled();
    expect(document.getElementById('__ptk-app')).toBeNull();
  });
});
