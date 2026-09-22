import browser from '../doubles/browser';
import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import SearchOptions from '@/options_page/components/options/SearchOptions.vue';

describe('SearchOptions', () => {
  // shallowMount stubs `v-list-item` and only renders its default slot, so it
  // can't see this component's `#title`/`#subtitle`/`#append` named slots
  // (see DownloadSaveMode.spec.js for the same pattern).
  test('renders the title through the migrated named slots', () => {
    const wrapper = mountOption(SearchOptions, {
      browserItems: { enablePtkSearch: true }
    });

    expect(wrapper.text()).toContain('Enable_search_suffix.message');
  });

  test('adopts the stored value before mount', () => {
    const wrapper = shallowMountOption(SearchOptions, {
      browserItems: { enablePtkSearch: false }
    });

    expect(wrapper.vm.enablePtkSearch).toBe(false);
  });

  test('persists a change to storage', async () => {
    const wrapper = shallowMountOption(SearchOptions, {
      browserItems: { enablePtkSearch: true }
    });
    await wrapper.vm.$nextTick();

    wrapper.vm.enablePtkSearch = false;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.enablePtkSearch).toBe(false);
  });
});
