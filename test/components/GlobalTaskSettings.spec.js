import browser from '../doubles/browser';
import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import GlobalTaskSettings from '@/options_page/components/options/GlobalTaskSettings.vue';

const browserItems = {
  globalTaskPageNumberStartWithOne: 1,
  globalTaskPageNumberLength: 3,
  combinWRRuleAndIRRuleWhenDontCreateWorkFolder: 1
};

describe('GlobalTaskSettings', () => {
  // shallowMount stubs `v-list-item` and only renders its default slot, so it
  // can't see this component's `#title`/`#subtitle`/`#append` named slots
  // (see DownloadSaveMode.spec.js for the same pattern).
  test('renders the title through the migrated named slots', () => {
    const wrapper = mountOption(GlobalTaskSettings, { browserItems });

    expect(wrapper.text()).toContain('_page_number_start_with_1.message');
  });

  test('adopts the stored values on creation', () => {
    const wrapper = shallowMountOption(GlobalTaskSettings, { browserItems });

    expect(wrapper.vm.pageNumberStartWithOne).toBe(1);
    expect(wrapper.vm.pageNumberLength).toBe(3);
    expect(wrapper.vm.combinWRRuleAndIRRuleWhenDontCreateWorkFolder).toBe(1);
  });

  test('exposes the page-number-length options, including the dynamic sentinel', () => {
    const wrapper = shallowMountOption(GlobalTaskSettings, { browserItems });

    expect(wrapper.vm.pageNumberLengthOptions).toEqual([
      { text: '_disable.message', value: 0 },
      { text: '_dynamic.message', value: -1 },
      { text: '2', value: 2 },
      { text: '3', value: 3 },
      { text: '4', value: 4 }
    ]);
  });

  test('exposes the page-number-start-with-one options', () => {
    const wrapper = shallowMountOption(GlobalTaskSettings, { browserItems });

    expect(wrapper.vm.pageNumberStartWithOneOptions).toEqual([
      { text: '_enable.message', value: 1 },
      { text: '_disable.message', value: 0 }
    ]);
  });

  test.each([
    ['pageNumberStartWithOne', 0, 'globalTaskPageNumberStartWithOne'],
    ['pageNumberLength', 4, 'globalTaskPageNumberLength'],
    ['combinWRRuleAndIRRuleWhenDontCreateWorkFolder', 0, 'combinWRRuleAndIRRuleWhenDontCreateWorkFolder']
  ])('persists a change to %s under the %s storage key', async (dataKey, newValue, storageKey) => {
    const wrapper = shallowMountOption(GlobalTaskSettings, { browserItems });

    // created() assigns each data key from browserItems, which is itself a
    // change the matching watcher is queued to report on the next flush.
    // Let that settle first so it can't cancel out against the value this
    // test is about to set (same tick, net-zero change never calls the cb).
    await wrapper.vm.$nextTick();

    wrapper.vm[dataKey] = newValue;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items[storageKey]).toBe(newValue);
  });
});
