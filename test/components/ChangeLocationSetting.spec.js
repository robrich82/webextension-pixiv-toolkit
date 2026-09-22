import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import ChangeLocationSetting from '@/options_page/components/options/ChangeLocationSetting.vue';
import ChangeLocationBtn from '@/options_page/components/options/ChangeLocationBtn.vue';

const baseProps = {
  modelValue: '',
  settingTitle: 'Where to save',
  dialogTitle: 'Set a location',
  dialogHint: 'Relative to the download root'
};

describe('ChangeLocationSetting', () => {
  test('reports "Not set" when there is no location yet', () => {
    const wrapper = shallowMountOption(ChangeLocationSetting, {
      propsData: { ...baseProps, modelValue: '' }
    });

    expect(wrapper.vm.settingHint).toBe('Not set');
  });

  test('reports the current location once one is set', () => {
    const wrapper = shallowMountOption(ChangeLocationSetting, {
      propsData: { ...baseProps, modelValue: 'downloads/pixiv/' }
    });

    expect(wrapper.vm.settingHint).toBe('downloads/pixiv/');
  });

  test('the location computed mirrors the modelValue prop and emits update:modelValue on write', () => {
    const wrapper = shallowMountOption(ChangeLocationSetting, {
      propsData: { ...baseProps, modelValue: 'downloads/pixiv/' }
    });

    expect(wrapper.vm.location).toBe('downloads/pixiv/');

    wrapper.vm.location = 'downloads/other/';

    expect(wrapper.emitted('update:modelValue')).toEqual([['downloads/other/']]);
  });

  // shallowMount stubs `v-list-item` and only renders a stub's *default*
  // slot, so it can't see change-location-btn -- it lives in the `#append`
  // named slot. A real mount is the only way to reach it (see
  // DownloadSaveMode.spec.js for the same pattern).
  test('disables the change-location button unless enableExtTakeOverDownloads is set', () => {
    const disabled = mountOption(ChangeLocationSetting, {
      propsData: baseProps,
      browserItems: { enableExtTakeOverDownloads: false }
    });

    expect(disabled.findComponent(ChangeLocationBtn).props('disabled')).toBe(true);

    const enabled = mountOption(ChangeLocationSetting, {
      propsData: baseProps,
      browserItems: { enableExtTakeOverDownloads: true }
    });

    expect(enabled.findComponent(ChangeLocationBtn).props('disabled')).toBe(false);
  });
});
