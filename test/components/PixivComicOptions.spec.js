import browser from '../doubles/browser';
import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import PixivComicOptions from '@/options_page/components/options/PixivComicOptions.vue';
import RenameDialog from '@/options_page/components/options/RenameDialog.vue';

const browserItems = {
  pixivComicEpisodeRenameRule: '{id}_{title}',
  pixivComicEpisodeRenameImageRule: 'p{pageNum}',
  pixivComicEpisodePageNumberStartWithOne: 1,
  pixivComicEpisodePageNumberLength: 3
};

describe('PixivComicOptions', () => {
  // shallowMount stubs `v-list-item` and only renders its default slot, so it
  // can't see this component's `#title`/`#subtitle`/`#append` named slots
  // (see DownloadSaveMode.spec.js for the same pattern).
  test('renders the title through the migrated named slots', () => {
    const wrapper = mountOption(PixivComicOptions, { browserItems });

    expect(wrapper.text()).toContain('_rename_pixiv_comic_episode_image.message');
  });

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

  // Each list item opens the rename dialog at the same position in the
  // template: item 0 → episode rule, item 1 → image rule.
  test.each([
    [0, '_rename_comic.message'],
    [1, '_rename_pixiv_comic_episode_image.message'],
  ])('clicking list item %i opens the "%s" rename dialog', async (index, title) => {
    const wrapper = mountOption(PixivComicOptions, { browserItems });
    const dialog = wrapper.findAllComponents(RenameDialog)[index];

    expect(dialog.props('title')).toBe(title);
    expect(dialog.props('show')).toBe(false);

    await wrapper.findAll('.v-list-item')[index].trigger('click');

    expect(dialog.props('show')).toBe(true);
  });

  // The page-number watchers persist under the same "Episode"-prefixed keys
  // that created() reads back in.
  test.each([
    ['pageNumberStartWithOne', 0, 'pixivComicEpisodePageNumberStartWithOne'],
    ['pageNumberLength', -1, 'pixivComicEpisodePageNumberLength']
  ])('persists a change to %s under the Episode key', async (dataKey, newValue, storageKey) => {
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

  test('renameImageRule persists a change under the Episode key', async () => {
    const wrapper = shallowMountOption(PixivComicOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.renameImageRule = 'p{pageNum}_new';
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.pixivComicEpisodeRenameImageRule).toBe('p{pageNum}_new');
  });
});
