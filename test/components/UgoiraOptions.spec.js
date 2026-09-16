import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import UgoiraOptions from '@/options_page/components/options/UgoiraOptions.vue';

const browserItems = {
  ugoiraRenameRule: '{id}_{title}',
  ugoiraCustomFFmpegCommand: '-f concat',
  animationJsonFormat: 2,
  ugoiraRelativeLocation: 'ugoira/'
};

describe('UgoiraOptions', () => {
  test('adopts every stored value on creation', () => {
    const wrapper = shallowMountOption(UgoiraOptions, { browserItems });

    expect(wrapper.vm.renameRule).toBe('{id}_{title}');
    expect(wrapper.vm.ugoiraCustomFFmpegCommand).toBe('-f concat');
    expect(wrapper.vm.animationJsonFormat).toBe(2);
    expect(wrapper.vm.location).toBe('ugoira/');
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

  // There is no `location` watcher on this component, so changing it is
  // never persisted (mirrors the same gap on PixivComicOptions.renameImageRule).
  // Asserting `storage.local.set` was never called, rather than just that one
  // key is undefined, also catches a watcher that persists under the wrong key.
  test('location has no watcher: changing it is never persisted', async () => {
    const wrapper = shallowMountOption(UgoiraOptions, { browserItems });
    await wrapper.vm.$nextTick();
    browser.storage.local.set.mockClear();

    wrapper.vm.location = 'new/';
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });
});
