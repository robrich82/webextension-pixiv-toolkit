import browser from '../doubles/browser';
import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import MangaOptions from '@/options_page/components/options/MangaOptions.vue';

const browserItems = {
  mangaRenameRule: '{id}_{title}',
  mangaRenameImageRule: 'p{pageNum}',
  mangaPageNumberStartWithOne: 1,
  mangaPageNumberLength: 3
};

describe('MangaOptions', () => {
  // shallowMount stubs `v-list-item` and only renders its default slot, so it
  // can't see this component's `#title`/`#subtitle`/`#append` named slots
  // (see DownloadSaveMode.spec.js for the same pattern).
  test('renders the title through the migrated named slots', () => {
    const wrapper = mountOption(MangaOptions, { browserItems });

    expect(wrapper.text()).toContain('_rename_manga.message');
  });

  test('adopts every stored value on creation', () => {
    const wrapper = shallowMountOption(MangaOptions, { browserItems });

    expect(wrapper.vm.renameRule).toBe('{id}_{title}');
    expect(wrapper.vm.renameImageRule).toBe('p{pageNum}');
    expect(wrapper.vm.pageNumberStartWithOne).toBe(1);
    expect(wrapper.vm.pageNumberLength).toBe(3);
  });

  test('builds the rename quick-pick metas, with the image dialog adding a page-number holder', () => {
    const wrapper = shallowMountOption(MangaOptions, { browserItems });

    const holders = wrapper.vm.renameMetas.map(meta => meta.holder);
    expect(holders).toEqual(['{id}', '{authorId}', '{title}', '{author}', '{year}', '{month}', '{day}']);

    const imageHolders = wrapper.vm.renameImageMetas.map(meta => meta.holder);
    expect(imageHolders).toEqual([...holders, '{pageNum}']);
  });

  test.each([
    ['pageNumberStartWithOne', 0, 'mangaPageNumberStartWithOne'],
    ['pageNumberLength', -1, 'mangaPageNumberLength']
  ])('persists a change to %s', async (dataKey, newValue, storageKey) => {
    const wrapper = shallowMountOption(MangaOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm[dataKey] = newValue;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items[storageKey]).toBe(newValue);
  });

  test('renameRule falls back to the default rule when cleared, but the visible field is left empty', async () => {
    const wrapper = shallowMountOption(MangaOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.renameRule = '';
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.mangaRenameRule).toBe('{id}_{title}');
    // The watcher reassigns the local `val`, not `this.renameRule`, so the
    // on-screen field stays empty even though storage gets the default — the
    // same asymmetry documented for FanboxPostSettings.renameImageRule.
    expect(wrapper.vm.renameRule).toBe('');
  });

  test('renameImageRule falls back to the default image rule when cleared, but the visible field is left empty', async () => {
    const wrapper = shallowMountOption(MangaOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.renameImageRule = '';
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.mangaRenameImageRule).toBe('p{pageNum}');
    expect(wrapper.vm.renameImageRule).toBe('');
  });
});
