import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import UgoiraExtendDialog from '@/options_page/components/options/UgoiraExtendDialog.vue';

const browserItems = {
  enableWhenUnderSeconds: 2,
  extendDuration: 4,
  enableExtend: true
};

describe('UgoiraExtendDialog', () => {
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
