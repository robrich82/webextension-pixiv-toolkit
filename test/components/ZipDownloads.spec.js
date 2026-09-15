import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import ZipDownloads from '@/options_page/components/options/option-items/ZipDownloads.vue';

describe('ZipDownloads', () => {
  test('hides itself when downloadSaveMode is not 0', () => {
    const wrapper = shallowMountOption(ZipDownloads, {
      browserItems: { downloadSaveMode: 1, globalZipMultipleImages: 1 }
    });

    expect(wrapper.vm.showThis).toBe(false);
  });

  test('shows itself and adopts the stored value when downloadSaveMode is 0', () => {
    const wrapper = shallowMountOption(ZipDownloads, {
      browserItems: { downloadSaveMode: 0, globalZipMultipleImages: 2 }
    });

    expect(wrapper.vm.showThis).toBe(true);
    expect(wrapper.vm.value).toBe(2);
  });

  test('exposes the four zip options', () => {
    const wrapper = shallowMountOption(ZipDownloads, {
      browserItems: { downloadSaveMode: 0, globalZipMultipleImages: 1 }
    });

    expect(wrapper.vm.options).toEqual([
      { text: '_enable.message', value: 1 },
      { text: '_only_if_the_work_has_multiple_images.message', value: 2 },
      { text: '_only_when_downloading_multiple_images.message', value: 3 },
      { text: '_disable.message', value: 0 }
    ]);
  });

  test('persists a valid new value to storage', async () => {
    const wrapper = shallowMountOption(ZipDownloads, {
      browserItems: { downloadSaveMode: 0, globalZipMultipleImages: 1 }
    });

    wrapper.vm.value = 3;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.globalZipMultipleImages).toBe(3);
  });

  test('reacts to a later downloadSaveMode change via storage.onChanged', async () => {
    const wrapper = shallowMountOption(ZipDownloads, {
      browserItems: { downloadSaveMode: 1, globalZipMultipleImages: 1 }
    });

    expect(wrapper.vm.showThis).toBe(false);

    await browser.storage.local.set({ downloadSaveMode: 0 });

    expect(wrapper.vm.showThis).toBe(true);
  });
});
