import browser from '../doubles/browser';
import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import UgoiraOptions from '@/options_page/components/options/UgoiraOptions.vue';
import RenameDialog from '@/options_page/components/options/RenameDialog.vue';
import { flushPromises } from '@vue/test-utils';
import { VSelect } from 'vuetify/components';

const browserItems = {
  ugoiraRenameRule: '{id}_{title}',
  animationJsonFormat: 2
};

/** WebCodecs that can encode only `codecs`, by their codec strings' prefixes. */
function encodable(...prefixes) {
  vi.stubGlobal('VideoEncoder', {
    isConfigSupported: async ({ codec }) => ({ supported: prefixes.some(prefix => codec.startsWith(prefix)) })
  });
}

/** The codec dropdown of the `format` row. */
const codecSelect = (wrapper, format) => wrapper.find(`.ugoira-codec-${format}`).findComponent(VSelect);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UgoiraOptions', () => {
  // shallowMount stubs `v-list-item` and only renders its default slot, so it
  // can't see this component's `#title`/`#subtitle`/`#append` named slots
  // (see DownloadSaveMode.spec.js for the same pattern).
  test('renders the title through the migrated named slots', () => {
    const wrapper = mountOption(UgoiraOptions, { browserItems });

    expect(wrapper.text()).toContain('rename_ugoira_file.message');
  });

  test('has no FFmpeg command field any more', () => {
    const wrapper = mountOption(UgoiraOptions, { browserItems });

    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.find('a[href*="help.md"]').exists()).toBe(false);
  });

  test('adopts every stored value on creation', () => {
    const wrapper = shallowMountOption(UgoiraOptions, { browserItems });

    expect(wrapper.vm.renameRule).toBe('{id}_{title}');
    expect(wrapper.vm.animationJsonFormat).toBe(2);
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

  test('clicking the rename item opens the "rename_ugoira.message" rename dialog', async () => {
    const wrapper = mountOption(UgoiraOptions, { browserItems });
    const dialog = wrapper.findComponent(RenameDialog);

    expect(dialog.props('title')).toBe('rename_ugoira.message');
    expect(dialog.props('show')).toBe(false);

    await wrapper.findAll('.v-list-item')[0].trigger('click');

    expect(dialog.props('show')).toBe(true);
  });

  describe('video codecs', () => {
    test('offers only the codecs each format holds, its default selected when unset', async () => {
      encodable('avc1.', 'vp09.', 'av01.', 'hvc1.', 'vp8');
      const wrapper = mountOption(UgoiraOptions, { browserItems });
      await flushPromises();

      const offered = format => codecSelect(wrapper, format).props('items').map(item => item.value);
      expect(offered('webm')).toEqual(['vp9', 'av1', 'vp8']);
      for (const format of ['mp4', 'mov', 'mkv']) {
        expect(offered(format)).toEqual(['avc', 'vp9', 'av1', 'hevc', 'vp8']);
      }
      expect(['webm', 'mp4', 'mov', 'mkv'].map(format => codecSelect(wrapper, format).props('modelValue')))
        .toEqual(['vp9', 'avc', 'avc', 'avc']);
      expect(wrapper.find('.ugoira-codec-mp4').text()).toContain('MP4 ugoira_codec.message');
    });

    test("shows the stored codec, and the default for one the format can't hold", async () => {
      encodable('vp');
      const wrapper = mountOption(UgoiraOptions, {
        browserItems: { ...browserItems, ugoiraMP4Codec: 'vp9', ugoiraWEBMCodec: 'avc', ugoiraMKVCodec: 'prores' }
      });

      expect(codecSelect(wrapper, 'mp4').props('modelValue')).toBe('vp9');
      expect(codecSelect(wrapper, 'webm').props('modelValue')).toBe('vp9');
      expect(codecSelect(wrapper, 'mkv').props('modelValue')).toBe('avc');
    });

    test("picking a codec stores it under that format's setting only", async () => {
      encodable('vp');
      const wrapper = mountOption(UgoiraOptions, { browserItems });

      codecSelect(wrapper, 'mov').vm.$emit('update:modelValue', 'av1');
      await flushPromises();

      expect(browser.storage.local.items.ugoiraMOVCodec).toBe('av1');
      expect(browser.storage.local.items).not.toHaveProperty('ugoiraMP4Codec');
      expect(codecSelect(wrapper, 'mov').props('modelValue')).toBe('av1');
    });

    test("marks the codecs this browser can't encode, and the row whose choice is one", async () => {
      encodable('vp09.', 'vp8');
      const wrapper = mountOption(UgoiraOptions, { browserItems: { ...browserItems, ugoiraMKVCodec: 'vp9' } });
      await flushPromises();

      const marked = format => codecSelect(wrapper, format).props('items')
        .filter(item => item.props.subtitle === 'codec_unencodable.message').map(item => item.value);
      expect(marked('mp4')).toEqual(['avc', 'av1', 'hevc']);
      expect(marked('webm')).toEqual(['av1']);
      // MP4 keeps its default, H.264, which this browser can't encode; MKV chose VP9.
      expect(codecSelect(wrapper, 'mp4').props('messages')).toBe('codec_unencodable.message');
      expect(codecSelect(wrapper, 'mkv').props('messages')).toEqual([]);
      expect(wrapper.find('.ugoira-codec-mp4').text()).toContain('codec_unencodable.message');
    });

    test('marks nothing until WebCodecs answers', () => {
      vi.stubGlobal('VideoEncoder', { isConfigSupported: () => new Promise(() => {}) });
      const wrapper = mountOption(UgoiraOptions, { browserItems });

      expect(codecSelect(wrapper, 'mp4').props('items').every(item => !item.props.subtitle)).toBe(true);
      expect(codecSelect(wrapper, 'mp4').props('messages')).toEqual([]);
    });
  });
});
