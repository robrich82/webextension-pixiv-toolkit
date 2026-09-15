import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import DontCreateWorkFolder from '@/options_page/components/options/option-items/DontCreateWorkFolder.vue';

describe('DontCreateWorkFolder', () => {
  test('hides itself when downloadSaveMode is not 1', () => {
    const wrapper = shallowMountOption(DontCreateWorkFolder, {
      browserItems: { downloadSaveMode: 0, dontCreateWorkFolder: 0 }
    });

    expect(wrapper.vm.showThis).toBe(false);
  });

  test('shows itself and adopts the stored value when downloadSaveMode is 1', () => {
    const wrapper = shallowMountOption(DontCreateWorkFolder, {
      browserItems: { downloadSaveMode: 1, dontCreateWorkFolder: 2 }
    });

    expect(wrapper.vm.showThis).toBe(true);
    expect(wrapper.vm.value).toBe(2);
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

    wrapper.vm.value = 3;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.dontCreateWorkFolder).toBe(3);
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
