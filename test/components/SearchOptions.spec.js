import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import SearchOptions from '@/options_page/components/options/SearchOptions.vue';

describe('SearchOptions', () => {
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
