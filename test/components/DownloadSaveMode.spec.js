import browser from '../doubles/browser';
import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import DownloadSaveMode from '@/options_page/components/options/option-items/DownloadSaveMode.vue';

describe('DownloadSaveMode', () => {
  // shallowMount stubs `v-list-item` and only renders a stub's *default*
  // slot, so it can't see this component's actual markup -- everything here
  // lives in the `#title`/`#subtitle`/`#append` named slots. A real mount is
  // the only way to pin that the migration's slot names and the `v-select`
  // `item-title`/`item-value` mapping (this component's options are
  // `{text, value}`, not Vuetify 3's default `{title, value}` shape) actually
  // reach the DOM.
  test('renders the title, subtitle, and the selected option label', () => {
    const wrapper = mountOption(DownloadSaveMode, {
      browserItems: { downloadSaveMode: 0 }
    });

    expect(wrapper.find('.v-list-item-title').text()).toBe('_download_save_mode.message');
    expect(wrapper.find('.v-list-item-subtitle').text()).toBe('_download_save_mode_0_desc.message');
    expect(wrapper.find('.v-select__selection-text').text()).toBe('_pack_in_zip.message');
  });

  test('adopts the stored value on creation', () => {
    const wrapper = shallowMountOption(DownloadSaveMode, {
      browserItems: { downloadSaveMode: 1 }
    });

    expect(wrapper.vm.value).toBe(1);
    expect(wrapper.find('v-list-item-stub').exists()).toBe(true);
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
    await wrapper.vm.$nextTick();

    wrapper.vm.value = 1;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.downloadSaveMode).toBe(1);
  });

  test('rejects an out-of-range value and reverts to the previous one', async () => {
    const wrapper = shallowMountOption(DownloadSaveMode, {
      browserItems: { downloadSaveMode: 0 }
    });
    await wrapper.vm.$nextTick();

    wrapper.vm.value = 5;
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.value).toBe(0);
    // The revert (`this.value = oldValue`) is itself a write the watcher
    // observes, so it re-runs and persists the reverted value too.
    expect(browser.storage.local.items.downloadSaveMode).toBe(0);
  });
});
