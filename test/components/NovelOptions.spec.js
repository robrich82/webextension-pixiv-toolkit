import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import NovelOptions from '@/options_page/components/options/NovelOptions.vue';

const browserItems = {
  novelRenameRule: '{id}_{title}',
  novelIncludeDescription: false
};

describe('NovelOptions', () => {
  test('adopts every stored value on creation', () => {
    const wrapper = shallowMountOption(NovelOptions, { browserItems });

    expect(wrapper.vm.renameRule).toBe('{id}_{title}');
    expect(wrapper.vm.novelIncludeDescription).toBe(false);
  });

  test('builds the rename quick-pick metas, including the Fanbox-series holders', () => {
    const wrapper = shallowMountOption(NovelOptions, { browserItems });

    expect(wrapper.vm.renameMetas.map(meta => meta.holder)).toEqual([
      '{id}', '{title}', '{author}', '{authorId}', '{year}', '{month}', '{day}',
      '{seriesId}', '{seriesTitle}', '{seriesOrder}'
    ]);
  });

  test('openRenameDialog opens the dialog', () => {
    const wrapper = shallowMountOption(NovelOptions, { browserItems });

    wrapper.vm.openRenameDialog();

    expect(wrapper.vm.showRenameDialog).toBe(true);
  });

  test('renameRule falls back to the default rule when cleared, and persists it', async () => {
    const wrapper = shallowMountOption(NovelOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.renameRule = '';
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.renameRule).toBe('{id}_{title}');
    expect(browser.storage.local.items.novelRenameRule).toBe('{id}_{title}');
  });

  test('renameRule persists a real edit as-is', async () => {
    const wrapper = shallowMountOption(NovelOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.renameRule = '{title}_{author}';
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.novelRenameRule).toBe('{title}_{author}');
  });

  test('novelIncludeDescription is guarded against the created()-triggered echo: no real change, no write', async () => {
    const wrapper = shallowMountOption(NovelOptions, { browserItems });

    // created() assigns this.novelIncludeDescription = browserItems.novelIncludeDescription,
    // which is itself a watched write; the watcher guards against persisting
    // that echo by comparing back against browserItems.
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.novelIncludeDescription).toBeUndefined();
  });

  test('novelIncludeDescription persists a genuine change', async () => {
    const wrapper = shallowMountOption(NovelOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.novelIncludeDescription = true;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.novelIncludeDescription).toBe(true);
  });
});
