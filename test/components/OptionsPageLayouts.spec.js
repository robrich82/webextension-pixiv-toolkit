import fs from 'fs';
import path from 'path';
import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import ChangeLogs from '@/options_page/components/ChangeLogs.vue';
import NewSettings from '@/options_page/components/NewSettings.vue';
import Options from '@/options_page/components/Options.vue';
import Sponsors from '@/options_page/components/Sponsors.vue';
import ThirdParty from '@/options_page/components/ThirdParty.vue';

// These pages only arrange other components; the specs pin which ones.
const missing = (wrapper, names) => names.filter(name => !wrapper.find(`${name}-stub`).exists());

describe('layout pages', () => {
  test('Options shows every settings section except the disabled search one', () => {
    const wrapper = shallowMountOption(Options);

    expect(missing(wrapper, ['download-task-settings', 'download-options', 'history-options', 'interface-options', 'other-options']))
      .toEqual([]);
    expect(wrapper.find('search-options-stub').exists()).toBe(false);
  });

  test('NewSettings lists the newest option items', () => {
    const wrapper = shallowMountOption(NewSettings);

    expect(missing(wrapper, ['download-save-mode', 'zip-downloads', 'dont-create-work-folder', 'combine-rename-rules']))
      .toEqual([]);
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
    vi.restoreAllMocks();
  });

  // A real mount: the list items render their name through #title.
  test('lists each library and opens its homepage on click', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const wrapper = mountOption(ThirdParty);
    const items = wrapper.findAll('.v-list-item');

    expect(items.map(item => item.find('.third-party__name').text())).toEqual([
      'ffmpeg.wasm', 'JSZip', 'Dexie.js', 'js-epub-maker', 'Handlebars', 'Vue.js', 'Vue Router', 'Vuetify',
      'vue-i18n', 'vue-virtual-scroller', 'Material Design Icons', 'Moment.js', 'mitt', 'md5'
    ]);

    await items[0].trigger('click');

    expect(open).toHaveBeenCalledWith('https://github.com/ffmpegwasm/ffmpeg.wasm', '_blank');
  });

  test("shows each npm package's installed version", () => {
    const installed = name => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../node_modules', name, 'package.json'), 'utf8')).version;
    const versions = Object.fromEntries(mountOption(ThirdParty).findAll('.v-list-item')
      .map(item => [item.find('.third-party__name').text(), item.find('.third-party__version').text()]));

    expect(versions).toMatchObject({
      'ffmpeg.wasm': installed('@ffmpeg/core'),
      'Dexie.js': `${installed('dexie')}, 3.2.2`,
      'Vue.js': installed('vue'),
      'Vue Router': installed('vue-router'),
      Vuetify: installed('vuetify'),
      'vue-i18n': installed('vue-i18n'),
      'vue-virtual-scroller': installed('vue-virtual-scroller'),
      'Material Design Icons': installed('@mdi/font'),
      'Moment.js': installed('moment'),
      mitt: installed('mitt'),
      md5: installed('md5')
    });
  });

  // The vendored copies' versions are hardcoded, so pin them to the files that ship.
  test.each([
    ['JSZip', 'jszip/jszip.js', /JSZip v(\S+)/],
    ['Handlebars', 'handlebars-latest.js', /handlebars v(\S+)/]
  ])('shows the vendored %s version', (name, file, pattern) => {
    const header = fs.readFileSync(path.resolve(__dirname, '../../src/statics/lib', file), 'utf8');
    const item = mountOption(ThirdParty).findAll('.v-list-item').find(i => i.find('.third-party__name').text() === name);

    expect(item.find('.third-party__version').text()).toBe(header.match(pattern)[1]);
  });

  test('shows the vendored Dexie version used by the pages', () => {
    const dexie = fs.readFileSync(path.resolve(__dirname, '../../src/statics/lib/dexie/dexie.js'), 'utf8');

    expect(mountOption(ThirdParty).text()).toContain(`, ${dexie.match(/DEXIE_VERSION = '([^']+)'/)[1]}`);
  });

  test('titles the page through the extension i18n API', () => {
    expect(mountOption(ThirdParty).find('.card-title').text()).toBe('Third_Party');
  });
});
