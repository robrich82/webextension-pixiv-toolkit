import browser from '../doubles/browser';
import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import UgoiraOptions from '@/options_page/components/options/UgoiraOptions.vue';

const browserItems = {
  ugoiraRenameRule: '{id}_{title}',
  ugoiraCustomFFmpegCommand: '-f concat',
  animationJsonFormat: 2
};

describe('UgoiraOptions', () => {
  // shallowMount stubs `v-list-item` and only renders its default slot, so it
  // can't see this component's `#title`/`#subtitle`/`#append` named slots
  // (see DownloadSaveMode.spec.js for the same pattern).
  test('renders the title through the migrated named slots', () => {
    const wrapper = mountOption(UgoiraOptions, { browserItems });

    expect(wrapper.text()).toContain('rename_ugoira_file.message');
  });

  test('adopts every stored value on creation', () => {
    const wrapper = shallowMountOption(UgoiraOptions, { browserItems });

    expect(wrapper.vm.renameRule).toBe('{id}_{title}');
    expect(wrapper.vm.ugoiraCustomFFmpegCommand).toBe('-f concat');
    expect(wrapper.vm.animationJsonFormat).toBe(2);
  });

  test('falls back to an empty ffmpeg command when none is stored', () => {
    const wrapper = shallowMountOption(UgoiraOptions, {
      browserItems: { ...browserItems, ugoiraCustomFFmpegCommand: undefined }
    });

    expect(wrapper.vm.ugoiraCustomFFmpegCommand).toBe('');
  });

  test('builds the rename quick-pick metas', () => {
    const wrapper = shallowMountOption(UgoiraOptions, { browserItems });

    expect(wrapper.vm.renameMetas.map(meta => meta.holder)).toEqual([
      '{id}', '{title}', '{author}', '{authorId}', '{year}', '{month}', '{day}'
    ]);
  });

  test('openRenameDialog opens the dialog', () => {
    const wrapper = shallowMountOption(UgoiraOptions, { browserItems });

    wrapper.vm.openRenameDialog();

    expect(wrapper.vm.showRenameDialog).toBe(true);
  });

  test('renameRule falls back to the default rule when cleared, and persists it', async () => {
    const wrapper = shallowMountOption(UgoiraOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.renameRule = '';
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.renameRule).toBe('{id}_{title}');
    expect(browser.storage.local.items.ugoiraRenameRule).toBe('{id}_{title}');
  });

  test('animationJsonFormat persists a change', async () => {
    const wrapper = shallowMountOption(UgoiraOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.animationJsonFormat = 0;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.animationJsonFormat).toBe(0);
  });

  test('onUgoiraCustomFFmpegCommandChangeHandler trims and persists the command', async () => {
    const wrapper = shallowMountOption(UgoiraOptions, { browserItems });

    wrapper.vm.ugoiraCustomFFmpegCommand = '  -f concat -i input.txt  ';
    wrapper.vm.onUgoiraCustomFFmpegCommandChangeHandler();
    await browser._fake.flush();

    expect(browser.storage.local.items.ugoiraCustomFFmpegCommand).toBe('-f concat -i input.txt');
  });
});
