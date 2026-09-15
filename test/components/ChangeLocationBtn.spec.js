import { shallowMountOption } from '../helpers/mountOptionComponent';
import ChangeLocationBtn from '@/options_page/components/options/ChangeLocationBtn.vue';

describe('ChangeLocationBtn', () => {
  test('adopts the location prop once mounted', () => {
    const wrapper = shallowMountOption(ChangeLocationBtn, {
      propsData: { location: 'pixiv_downloads/' }
    });

    expect(wrapper.vm.inputLocation).toBe('pixiv_downloads/');
  });

  test('emits update:location when the input is a valid relative path', async () => {
    const wrapper = shallowMountOption(ChangeLocationBtn, {
      propsData: { location: '' }
    });

    wrapper.vm.inputLocation = 'downloads/pixiv/';
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:location')).toEqual([['downloads/pixiv/']]);
  });

  test('does not emit for an invalid relative path', async () => {
    const wrapper = shallowMountOption(ChangeLocationBtn, {
      propsData: { location: '' }
    });

    wrapper.vm.inputLocation = 'not:a/valid*path';
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:location')).toBeUndefined();
  });

  test('re-syncs the input from the location prop whenever the dialog opens', async () => {
    const wrapper = shallowMountOption(ChangeLocationBtn, {
      propsData: { location: 'first/' }
    });

    wrapper.vm.inputLocation = 'unsaved edit';
    await wrapper.vm.$nextTick();

    wrapper.vm.showDialog = true;
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.inputLocation).toBe('first/');
  });

  test('flags an invalid input through errorMessages', () => {
    const wrapper = shallowMountOption(ChangeLocationBtn, {
      propsData: { location: '' }
    });

    wrapper.vm.inputLocation = 'nope';
    void wrapper.vm.hint;

    expect(wrapper.vm.errorMessages).toEqual(['Invalid input, example: "pixiv_downloads/"']);
  });

  test('clears errorMessages once the input is valid again', () => {
    const wrapper = shallowMountOption(ChangeLocationBtn, {
      propsData: { location: 'existing/' }
    });

    wrapper.vm.inputLocation = 'nope';
    void wrapper.vm.hint;
    expect(wrapper.vm.errorMessages).toHaveLength(1);

    wrapper.vm.inputLocation = 'valid/';
    void wrapper.vm.hint;

    expect(wrapper.vm.errorMessages).toEqual([]);
  });
});
