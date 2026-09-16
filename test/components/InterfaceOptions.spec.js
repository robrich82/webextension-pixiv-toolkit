import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import InterfaceOptions from '@/options_page/components/options/InterfaceOptions.vue';

const browserItems = {
  autoActivateDownloadPanel: true,
  language: 'zh_CN',
  downloadPanelPosition: 'left',
  downloadPanelStyle: 2,
  showReloadInPopup: true,
  showPixivOmina: false
};

describe('InterfaceOptions', () => {
  test('adopts every stored value before mount', () => {
    const wrapper = shallowMountOption(InterfaceOptions, { browserItems });

    expect(wrapper.vm.autoActivateDownloadPanel).toBe(true);
    expect(wrapper.vm.language).toBe('zh_CN');
    expect(wrapper.vm.downloadPanelPosition).toBe('left');
    expect(wrapper.vm.downloadPanelStyle).toBe(2);
    expect(wrapper.vm.showReloadInPopup).toBe(true);
    expect(wrapper.vm.showPixivOmina).toBe(false);
  });

  test('falls back to the default language when none is stored', () => {
    const wrapper = shallowMountOption(InterfaceOptions, {
      browserItems: { ...browserItems, language: '' }
    });

    expect(wrapper.vm.language).toBe('default');
  });

  test('exposes the language, position and style option lists', () => {
    const wrapper = shallowMountOption(InterfaceOptions, { browserItems });

    expect(wrapper.vm.languageOptions).toEqual([
      { text: '_default.message', value: 'default' },
      { text: '简体中文', value: 'zh_CN' },
      { text: 'English', value: 'en' }
    ]);
    expect(wrapper.vm.downloadPanelPositionOptions).toEqual([
      { text: '_center.message', value: 'center' },
      { text: '_left.message', value: 'left' },
      { text: '_right.message', value: 'right' }
    ]);
    expect(wrapper.vm.downloadPanelStyleOptions).toEqual([
      { text: '_type.message 1', value: 1 },
      { text: '_type.message 2', value: 2 }
    ]);
  });

  test.each([
    ['showReloadInPopup', false],
    ['showPixivOmina', true]
  ])('persists a change to %s', async (key, newValue) => {
    const wrapper = shallowMountOption(InterfaceOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm[key] = newValue;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items[key]).toBe(newValue);
  });

  // Unlike the two above, this watcher coerces with `!!val` — a falsy-but-
  // non-boolean input (`0`) needs to persist as `false`, not `0`, to actually
  // exercise that coercion rather than just round-tripping a boolean.
  test('persists a change to autoActivateDownloadPanel as a coerced boolean', async () => {
    const wrapper = shallowMountOption(InterfaceOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.autoActivateDownloadPanel = 0;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.autoActivateDownloadPanel).toBe(false);
  });

  test('onLanguageChangeHandler persists the selected language', async () => {
    const wrapper = shallowMountOption(InterfaceOptions, { browserItems });

    wrapper.vm.onLanguageChangeHandler('en');
    await browser._fake.flush();

    expect(browser.storage.local.items.language).toBe('en');
  });

  test('onDownloadPanelPositionChangeHandler persists the selected position', async () => {
    const wrapper = shallowMountOption(InterfaceOptions, { browserItems });

    wrapper.vm.onDownloadPanelPositionChangeHandler('right');
    await browser._fake.flush();

    expect(browser.storage.local.items.downloadPanelPosition).toBe('right');
  });

  test('onDownloadPanelStyleChangeHandler persists the selected style as a number', async () => {
    const wrapper = shallowMountOption(InterfaceOptions, { browserItems });

    wrapper.vm.onDownloadPanelStyleChangeHandler('1');
    await browser._fake.flush();

    expect(browser.storage.local.items.downloadPanelStyle).toBe(1);
  });
});
