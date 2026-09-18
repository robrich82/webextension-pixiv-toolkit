import { shallowMountOption } from '../helpers/mountOptionComponent';
import ChangeLocationSetting from '@/options_page/components/options/ChangeLocationSetting.vue';

const baseProps = {
  value: '',
  settingTitle: 'Where to save',
  dialogTitle: 'Set a location',
  dialogHint: 'Relative to the download root'
};

describe('ChangeLocationSetting', () => {
  test('reports "Not set" when there is no location yet', () => {
    const wrapper = shallowMountOption(ChangeLocationSetting, {
      propsData: { ...baseProps, value: '' }
    });

    expect(wrapper.vm.settingHint).toBe('Not set');
  });

  test('reports the current location once one is set', () => {
    const wrapper = shallowMountOption(ChangeLocationSetting, {
      propsData: { ...baseProps, value: 'downloads/pixiv/' }
    });

    expect(wrapper.vm.settingHint).toBe('downloads/pixiv/');
  });

  test('the location computed mirrors the value prop and emits input on write', () => {
    const wrapper = shallowMountOption(ChangeLocationSetting, {
      propsData: { ...baseProps, value: 'downloads/pixiv/' }
    });

    expect(wrapper.vm.location).toBe('downloads/pixiv/');

    wrapper.vm.location = 'downloads/other/';

    expect(wrapper.emitted('input')).toEqual([['downloads/other/']]);
  });

  test('disables the change-location button unless enableExtTakeOverDownloads is set', () => {
    const disabled = shallowMountOption(ChangeLocationSetting, {
      propsData: baseProps,
      browserItems: { enableExtTakeOverDownloads: false }
    });

    expect(disabled.find('change-location-btn-stub').attributes('disabled')).toBe('true');

    const enabled = shallowMountOption(ChangeLocationSetting, {
      propsData: baseProps,
      browserItems: { enableExtTakeOverDownloads: true }
    });

    // @vue/test-utils 2's auto-stubs serialize a false boolean prop as the
    // literal attribute "false" rather than omitting it (@vue/test-utils 1
    // omitted it) -- this is a stub-rendering difference, not a component
    // behaviour change.
    expect(enabled.find('change-location-btn-stub').attributes('disabled')).toBe('false');
  });
});
