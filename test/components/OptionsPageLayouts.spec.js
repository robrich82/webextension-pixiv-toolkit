import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import ChangeLogs from '@/options_page/components/ChangeLogs.vue';
import NewSettings from '@/options_page/components/NewSettings.vue';
import Options from '@/options_page/components/Options.vue';
import Sponsors from '@/options_page/components/Sponsors.vue';
import ThirdParty from '@/options_page/components/ThirdParty.vue';

// These pages only arrange other components; the specs pin which ones.
describe('layout pages', () => {
  test('Options shows every settings section except the disabled search one', () => {
    const wrapper = shallowMountOption(Options);

    expect(['download-task-settings', 'download-options', 'history-options', 'interface-options', 'other-options']
      .map(name => wrapper.find(`${name}-stub`).exists())).toEqual([true, true, true, true, true]);
    expect(wrapper.find('search-options-stub').exists()).toBe(false);
  });

  test('NewSettings lists the newest option items', () => {
    const wrapper = shallowMountOption(NewSettings);

    expect(['download-save-mode', 'zip-downloads', 'dont-create-work-folder', 'combine-rename-rules']
      .map(name => wrapper.find(`${name}-stub`).exists())).toEqual([true, true, true, true]);
  });

  test('ChangeLogs titles and wraps the change log', () => {
    const wrapper = shallowMountOption(ChangeLogs);

    expect(wrapper.find('.card-title').text()).toBe('Change_History.message');
    expect(wrapper.find('change-log-stub').exists()).toBe(true);
  });

  test('Sponsors wraps the sponsors card', () => {
    expect(shallowMountOption(Sponsors).find('sponsors-card-stub').exists()).toBe(true);
  });
});

describe('ThirdParty', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // A real mount: the list items render their name through #title.
  test('lists each library and opens its homepage on click', async () => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    const wrapper = mountOption(ThirdParty);
    const items = wrapper.findAll('.v-list-item');

    expect(items.map(item => item.find('.v-list-item-title').text().split(' ')[0]))
      .toEqual(['ffmpeg.wasm', 'jszip', 'vuejs', 'vuetify', 'vue-i18n']);

    await items[0].trigger('click');

    expect(open).toHaveBeenCalledWith('https://github.com/ffmpegwasm/ffmpeg.wasm', '_blank');
  });

  test('titles the page through the extension i18n API', () => {
    expect(mountOption(ThirdParty).find('.card-title').text()).toBe('Third_Party');
  });
});
