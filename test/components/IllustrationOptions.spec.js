import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import IllustrationOptions from '@/options_page/components/options/IllustrationOptions.vue';

const browserItems = {
  illustRenameRule: '{id}_{title}',
  illustRenameImageRule: 'p{pageNum}',
  illustrationPageNumberStartWithOne: 1,
  illustrationPageNumberLength: 3,
  illustrationRelativeLocation: 'illust/'
};

describe('IllustrationOptions', () => {
  test('adopts every stored value on creation', () => {
    const wrapper = shallowMountOption(IllustrationOptions, { browserItems });

    expect(wrapper.vm.renameRule).toBe('{id}_{title}');
    expect(wrapper.vm.renameImageRule).toBe('p{pageNum}');
    expect(wrapper.vm.pageNumberStartWithOne).toBe(1);
    expect(wrapper.vm.pageNumberLength).toBe(3);
    expect(wrapper.vm.location).toBe('illust/');
  });

  test('builds the rename quick-pick metas, with the image dialog adding a page-number holder', () => {
    const wrapper = shallowMountOption(IllustrationOptions, { browserItems });

    const holders = wrapper.vm.renameMetas.map(meta => meta.holder);
    expect(holders).toEqual(['{id}', '{authorId}', '{title}', '{author}', '{year}', '{month}', '{day}']);

    const imageHolders = wrapper.vm.renameImageMetas.map(meta => meta.holder);
    expect(imageHolders).toEqual([...holders, '{pageNum}']);
  });

  test('exposes a "global setting" option alongside the page-number choices', () => {
    const wrapper = shallowMountOption(IllustrationOptions, { browserItems });

    expect(wrapper.vm.pageNumberStartWithOneOptions).toContainEqual({ text: '_global_setting.message', value: -2 });
    expect(wrapper.vm.pageNumberLengthOptions).toContainEqual({ text: '_global_setting.message', value: -2 });
  });

  test.each([
    ['pageNumberStartWithOne', 0, 'illustrationPageNumberStartWithOne'],
    ['pageNumberLength', -1, 'illustrationPageNumberLength'],
    ['location', 'new/', 'illustrationRelativeLocation']
  ])('persists a change to %s', async (dataKey, newValue, storageKey) => {
    const wrapper = shallowMountOption(IllustrationOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm[dataKey] = newValue;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items[storageKey]).toBe(newValue);
  });

  test('renameRule falls back to the default rule when cleared, but the visible field is left empty', async () => {
    const wrapper = shallowMountOption(IllustrationOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.renameRule = '';
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.illustRenameRule).toBe('{id}_{title}');
    // The watcher reassigns the local `val`, not `this.renameRule`, so the
    // on-screen field stays empty even though storage gets the default — the
    // same asymmetry documented for FanboxPostSettings.renameImageRule.
    expect(wrapper.vm.renameRule).toBe('');
  });

  test('renameImageRule falls back to the default image rule when cleared, but the visible field is left empty', async () => {
    const wrapper = shallowMountOption(IllustrationOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.renameImageRule = '';
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.illustRenameImageRule).toBe('p{pageNum}');
    expect(wrapper.vm.renameImageRule).toBe('');
  });
});
