import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import CombineRenameRules from '@/options_page/components/options/option-items/CombineRenameRules.vue';

describe('CombineRenameRules', () => {
  test('hides itself when downloadSaveMode is not 1', () => {
    const wrapper = shallowMountOption(CombineRenameRules, {
      browserItems: { downloadSaveMode: 0, combinWRRuleAndIRRuleWhenDontCreateWorkFolder: 0 }
    });

    expect(wrapper.vm.showThis).toBe(false);
    expect(wrapper.find('v-list-tile-stub').exists()).toBe(false);
  });

  test('shows itself and adopts the stored value when downloadSaveMode is 1', () => {
    const wrapper = shallowMountOption(CombineRenameRules, {
      browserItems: { downloadSaveMode: 1, combinWRRuleAndIRRuleWhenDontCreateWorkFolder: 1 }
    });

    expect(wrapper.vm.showThis).toBe(true);
    expect(wrapper.vm.value).toBe(1);
    expect(wrapper.find('v-list-tile-stub').exists()).toBe(true);
  });

  test('exposes the enable/disable options in the expected order', () => {
    const wrapper = shallowMountOption(CombineRenameRules, {
      browserItems: { downloadSaveMode: 1, combinWRRuleAndIRRuleWhenDontCreateWorkFolder: 0 }
    });

    expect(wrapper.vm.options).toEqual([
      { text: '_enable.message', value: 1 },
      { text: '_disable.message', value: 0 }
    ]);
  });

  test('persists a new value to storage when it changes', async () => {
    const wrapper = shallowMountOption(CombineRenameRules, {
      browserItems: { downloadSaveMode: 1, combinWRRuleAndIRRuleWhenDontCreateWorkFolder: 0 }
    });
    await wrapper.vm.$nextTick();

    wrapper.vm.value = 1;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.combinWRRuleAndIRRuleWhenDontCreateWorkFolder).toBe(1);
  });

  test('reacts to a later downloadSaveMode change via storage.onChanged', async () => {
    const wrapper = shallowMountOption(CombineRenameRules, {
      browserItems: { downloadSaveMode: 0, combinWRRuleAndIRRuleWhenDontCreateWorkFolder: 0 }
    });

    expect(wrapper.vm.showThis).toBe(false);

    await browser.storage.local.set({ downloadSaveMode: 1 });

    expect(wrapper.vm.showThis).toBe(true);
  });
});
