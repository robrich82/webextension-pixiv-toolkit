import browser from '../doubles/browser';
import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import UgoiraExtendDialog from '@/options_page/components/options/UgoiraExtendDialog.vue';

const browserItems = {
  enableWhenUnderSeconds: 2,
  extendDuration: 4,
  enableExtend: true
};

describe('UgoiraExtendDialog', () => {
  // shallowMount stubs `v-list-item` and only renders its default slot, so it
  // can't see this component's `#title`/`#subtitle`/`#append` named slots
  // (see DownloadSaveMode.spec.js for the same pattern). `v-dialog`'s content
  // also teleports to `document.body` rather than staying under the wrapper's
  // own root element, so `wrapper.text()` can't see it either -- read the
  // body directly.
  test('renders the title through the migrated named slots', () => {
    mountOption(UgoiraExtendDialog, { browserItems });

    expect(document.body.textContent).toContain('extend_enable.message');
  });

  test('adopts every stored value before mount', () => {
    const wrapper = shallowMountOption(UgoiraExtendDialog, { browserItems });

    expect(wrapper.vm.enableWhenUnderSeconds).toBe(2);
    expect(wrapper.vm.extendDuration).toBe(4);
    expect(wrapper.vm.enableExtend).toBe(true);
  });

  test('persists a change to enableExtend', async () => {
    const wrapper = shallowMountOption(UgoiraExtendDialog, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.enableExtend = false;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.enableExtend).toBe(false);
  });

  test('onEnableWhenUnderSecondsChangeHandler persists the current seconds threshold', async () => {
    const wrapper = shallowMountOption(UgoiraExtendDialog, { browserItems });

    wrapper.vm.enableWhenUnderSeconds = 3;
    wrapper.vm.onEnableWhenUnderSecondsChangeHandler();
    await browser._fake.flush();

    expect(browser.storage.local.items.enableWhenUnderSeconds).toBe(3);
  });

  test('onExtendDurationChangeHandler persists the current extend duration', async () => {
    const wrapper = shallowMountOption(UgoiraExtendDialog, { browserItems });

    wrapper.vm.extendDuration = 5;
    wrapper.vm.onExtendDurationChangeHandler();
    await browser._fake.flush();

    expect(browser.storage.local.items.extendDuration).toBe(5);
  });

  test('closing the dialog navigates back', async () => {
    const back = jest.fn();
    const wrapper = shallowMountOption(UgoiraExtendDialog, {
      browserItems,
      mocks: { $router: { go: back } }
    });

    wrapper.vm.showDialog = false;
    await wrapper.vm.$nextTick();

    expect(back).toHaveBeenCalledWith(-1);
  });
});
