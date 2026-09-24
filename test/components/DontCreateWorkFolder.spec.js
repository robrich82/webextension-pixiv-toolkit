import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import DontCreateWorkFolder from '@/options_page/components/options/option-items/DontCreateWorkFolder.vue';

describe('DontCreateWorkFolder', () => {
  test('hides itself when downloadSaveMode is not 1', () => {
    const wrapper = shallowMountOption(DontCreateWorkFolder, {
      browserItems: { downloadSaveMode: 0, dontCreateWorkFolder: 0 }
    });

    expect(wrapper.vm.showThis).toBe(false);
    expect(wrapper.find('v-list-item-stub').exists()).toBe(false);
  });

  test('shows itself and adopts the stored value when downloadSaveMode is 1', () => {
    const wrapper = shallowMountOption(DontCreateWorkFolder, {
      browserItems: { downloadSaveMode: 1, dontCreateWorkFolder: 2 }
    });

    expect(wrapper.vm.showThis).toBe(true);
    expect(wrapper.vm.value).toBe(2);
    expect(wrapper.find('v-list-item-stub').exists()).toBe(true);
  });

  test('exposes the four create-folder options', () => {
    const wrapper = shallowMountOption(DontCreateWorkFolder, {
      browserItems: { downloadSaveMode: 1, dontCreateWorkFolder: 0 }
    });

    expect(wrapper.vm.options).toEqual([
      { text: '_always_create.message', value: 0 },
      { text: '_only_if_the_work_has_one_image.message', value: 1 },
      { text: '_only_when_downloading_one_image.message', value: 3 },
      { text: '_always_dont.message', value: 2 }
    ]);
  });

  test('persists a valid new value to storage', async () => {
    const wrapper = shallowMountOption(DontCreateWorkFolder, {
      browserItems: { downloadSaveMode: 1, dontCreateWorkFolder: 0 }
    });
    await wrapper.vm.$nextTick();

    wrapper.vm.value = 3;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.dontCreateWorkFolder).toBe(3);
  });

  test('rejects an out-of-range value and reverts to the previous one', async () => {
    const wrapper = shallowMountOption(DontCreateWorkFolder, {
      browserItems: { downloadSaveMode: 1, dontCreateWorkFolder: 0 }
    });
    await wrapper.vm.$nextTick();

    wrapper.vm.value = 5;
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.value).toBe(0);
    // The revert (`this.value = oldValue`) is itself a write the watcher
    // observes, so it re-runs and persists the reverted value too.
    expect(browser.storage.local.items.dontCreateWorkFolder).toBe(0);
  });

  test('reacts to a later downloadSaveMode change via storage.onChanged', async () => {
    const wrapper = shallowMountOption(DontCreateWorkFolder, {
      browserItems: { downloadSaveMode: 0, dontCreateWorkFolder: 0 }
    });

    expect(wrapper.vm.showThis).toBe(false);

    await browser.storage.local.set({ downloadSaveMode: 1 });

    expect(wrapper.vm.showThis).toBe(true);
  });
});
