import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import MangaOptions from '@/options_page/components/options/MangaOptions.vue';

const browserItems = {
  mangaRenameRule: '{id}_{title}',
  mangaRenameImageRule: 'p{pageNum}',
  mangaPageNumberStartWithOne: 1,
  mangaPageNumberLength: 3
};

describe('MangaOptions', () => {
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

  test('renameRule falls back to the default rule when cleared', async () => {
    const wrapper = shallowMountOption(MangaOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.renameRule = '';
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.mangaRenameRule).toBe('{id}_{title}');
  });

  test('renameImageRule falls back to the default image rule when cleared', async () => {
    const wrapper = shallowMountOption(MangaOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.renameImageRule = '';
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.mangaRenameImageRule).toBe('p{pageNum}');
  });
});
