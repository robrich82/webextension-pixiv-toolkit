import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import FanboxPostSettings from '@/options_page/components/options/FanboxPostSettings.vue';

const browserItems = {
  fanboxPostRenameRule: '{id}_{title}',
  fanboxPostRenameImageRule: 'p{pageNum}',
  fanboxPostPageNumberStartWithOne: 1,
  fanboxPostPageNumberLength: 3
};

describe('FanboxPostSettings', () => {
  test('adopts every stored value on creation', () => {
    const wrapper = shallowMountOption(FanboxPostSettings, { browserItems });

    expect(wrapper.vm.renameRule).toBe('{id}_{title}');
    expect(wrapper.vm.renameImageRule).toBe('p{pageNum}');
    expect(wrapper.vm.pageNumberStartWithOne).toBe(1);
    expect(wrapper.vm.pageNumberLength).toBe(3);
  });

  test('builds the rename quick-pick metas, with the image dialog adding a page-number holder', () => {
    const wrapper = shallowMountOption(FanboxPostSettings, { browserItems });

    const holders = wrapper.vm.renameMetas.map(meta => meta.holder);
    expect(holders).toEqual(['{id}', '{title}', '{authorId}', '{author}', '{year}', '{month}', '{day}']);
    expect(wrapper.vm.renameImageMetas.map(meta => meta.holder)).toEqual([...holders, '{pageNum}']);
  });

  test.each([
    ['pageNumberStartWithOne', 0, 'fanboxPostPageNumberStartWithOne'],
    ['pageNumberLength', -1, 'fanboxPostPageNumberLength']
  ])('persists a change to %s', async (dataKey, newValue, storageKey) => {
    const wrapper = shallowMountOption(FanboxPostSettings, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm[dataKey] = newValue;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items[storageKey]).toBe(newValue);
  });

  test('renameRule falls back to the default rule when cleared, correcting the field too', async () => {
    const wrapper = shallowMountOption(FanboxPostSettings, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.renameRule = '';
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.renameRule).toBe('{id}_{title}');
    expect(browser.storage.local.items.fanboxPostRenameRule).toBe('{id}_{title}');
  });

  // Unlike renameRule, this watcher persists the default via a ternary
  // instead of also reassigning `this.renameImageRule` — the field itself is
  // left empty on screen even though storage gets the default.
  test('renameImageRule persists the default when cleared, but the field itself is left empty', async () => {
    const wrapper = shallowMountOption(FanboxPostSettings, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.renameImageRule = '';
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.fanboxPostRenameImageRule).toBe('p{pageNum}');
    expect(wrapper.vm.renameImageRule).toBe('');
  });

  test('renameImageRule persists a real edit as-is', async () => {
    const wrapper = shallowMountOption(FanboxPostSettings, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.renameImageRule = 'img_p{pageNum}';
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.fanboxPostRenameImageRule).toBe('img_p{pageNum}');
  });
});
