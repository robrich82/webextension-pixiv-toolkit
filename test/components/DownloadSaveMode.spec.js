import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import DownloadSaveMode from '@/options_page/components/options/option-items/DownloadSaveMode.vue';

describe('DownloadSaveMode', () => {
  test('adopts the stored value on creation', () => {
    const wrapper = shallowMountOption(DownloadSaveMode, {
      browserItems: { downloadSaveMode: 1 }
    });

    expect(wrapper.vm.value).toBe(1);
  });

  test('exposes the zip/folder options and a subtitle per value', () => {
    const wrapper = shallowMountOption(DownloadSaveMode, {
      browserItems: { downloadSaveMode: 0 }
    });

    expect(wrapper.vm.options).toEqual([
      { text: '_pack_in_zip.message', value: 0 },
      { text: '_save_in_folder.message', value: 1 }
    ]);
    expect(wrapper.vm.subTitle).toBe('_download_save_mode_0_desc.message');

    wrapper.vm.value = 1;

    expect(wrapper.vm.subTitle).toBe('_download_save_mode_1_desc.message');
  });

  test('persists a valid new value to storage', async () => {
    const wrapper = shallowMountOption(DownloadSaveMode, {
      browserItems: { downloadSaveMode: 0 }
    });

    wrapper.vm.value = 1;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.downloadSaveMode).toBe(1);
  });

  test('rejects an out-of-range value and reverts to the previous one', async () => {
    const wrapper = shallowMountOption(DownloadSaveMode, {
      browserItems: { downloadSaveMode: 0 }
    });

    wrapper.vm.value = 5;
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.value).toBe(0);
    // The revert (`this.value = oldValue`) is itself a write the watcher
    // observes, so it re-runs and persists the reverted value too.
    expect(browser.storage.local.items.downloadSaveMode).toBe(0);
  });
});
