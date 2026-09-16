import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import PixivComicOptions from '@/options_page/components/options/PixivComicOptions.vue';

const browserItems = {
  pixivComicEpisodeRenameRule: '{id}_{title}',
  pixivComicEpisodeRenameImageRule: 'p{pageNum}',
  pixivComicEpisodePageNumberStartWithOne: 1,
  pixivComicEpisodePageNumberLength: 3
};

describe('PixivComicOptions', () => {
  test('adopts every stored value on creation, all under the "Episode" key prefix', () => {
    const wrapper = shallowMountOption(PixivComicOptions, { browserItems });

    expect(wrapper.vm.renameRule).toBe('{id}_{title}');
    expect(wrapper.vm.renameImageRule).toBe('p{pageNum}');
    expect(wrapper.vm.pageNumberStartWithOne).toBe(1);
    expect(wrapper.vm.pageNumberLength).toBe(3);
  });

  test('builds the rename quick-pick metas, with the image dialog adding a page-number holder', () => {
    const wrapper = shallowMountOption(PixivComicOptions, { browserItems });

    const holders = wrapper.vm.renameMetas.map(meta => meta.holder);
    expect(holders).toEqual(['{id}', '{title}', '{subTitle}', '{numberingTitle}', '{workId}', '{workTitle}']);
    expect(wrapper.vm.renameImageMetas.map(meta => meta.holder)).toEqual([...holders, '{pageNum}']);
  });

  // The template references `showRenameImageDialog`
  // (`@click="showRenameImageDialog = true"`, `:show.sync="showRenameImageDialog"`)
  // but only `showRenameDialog` is declared in data() — a pre-existing dead
  // binding (Vue logs an "is not defined on the instance" warning on every
  // mount, and since the property isn't reactive, the image rename dialog can
  // never actually open). Documented here rather than fixed, matching the
  // other quirks in this file.
  test('showRenameImageDialog is a pre-existing dead binding: not declared in data()', () => {
    const wrapper = shallowMountOption(PixivComicOptions, { browserItems });

    expect(Object.keys(wrapper.vm.$data)).not.toContain('showRenameImageDialog');
    expect(Object.keys(wrapper.vm.$data)).toContain('showRenameDialog');
  });

  // The page-number watchers persist under keys that drop "Episode", even
  // though created() reads the "Episode"-prefixed keys back in — a pre-existing
  // read/write key mismatch this test documents rather than papers over.
  test.each([
    ['pageNumberStartWithOne', 0, 'pixivComicPageNumberStartWithOne'],
    ['pageNumberLength', -1, 'pixivComicPageNumberLength']
  ])('persists a change to %s under the non-Episode key', async (dataKey, newValue, storageKey) => {
    const wrapper = shallowMountOption(PixivComicOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm[dataKey] = newValue;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items[storageKey]).toBe(newValue);
  });

  test('renameRule persists a real edit as-is', async () => {
    const wrapper = shallowMountOption(PixivComicOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.renameRule = '{workTitle}/{numberingTitle}';
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.pixivComicEpisodeRenameRule).toBe('{workTitle}/{numberingTitle}');
  });

  // Setting this.renameRule to the default *inside* the watcher re-triggers
  // the same watcher before this flush ends (the same self-triggering
  // pattern DownloadSaveMode's revert relies on), so the second run's write
  // overwrites the first: storage ends up with the default too, not the
  // empty string the first call sent.
  test('renameRule falls back to the default rule when cleared, and storage ends up with the default', async () => {
    const wrapper = shallowMountOption(PixivComicOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.renameRule = '';
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.renameRule).toBe('{id}_{title}/{numbering_title}_{workTitle}');
    expect(browser.storage.local.items.pixivComicEpisodeRenameRule).toBe('{id}_{title}/{numbering_title}_{workTitle}');
  });

  // There is no `renameImageRule` watcher on this component at all, so
  // editing it never reaches storage. Asserting `storage.local.set` was never
  // called (rather than just that one key is undefined) also catches the
  // read/write key-mismatch bug documented above, in case a watcher ever
  // appears here writing under the wrong key.
  test('renameImageRule has no watcher: changing it is never persisted', async () => {
    const wrapper = shallowMountOption(PixivComicOptions, { browserItems });
    await wrapper.vm.$nextTick();
    browser.storage.local.set.mockClear();

    wrapper.vm.renameImageRule = 'p{pageNum}_new';
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });
});
