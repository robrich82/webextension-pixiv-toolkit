import { shallowMountOption } from '../helpers/mountOptionComponent';
import RenameDialog from '@/options_page/components/options/RenameDialog.vue';

const metas = [
  { title: 'Id', holder: '{id}' },
  { title: 'Title', holder: '{title}' }
];

const baseProps = {
  title: 'Rename',
  metas,
  value: 'foo_bar',
  defaultValue: '{id}_{title}'
};

describe('RenameDialog', () => {
  test('adopts the value prop as the rename format on creation', () => {
    const wrapper = shallowMountOption(RenameDialog, { propsData: baseProps });

    expect(wrapper.vm.renameFormat).toBe('foo_bar');
  });

  test('the hint computed always reports empty, shadowing the hint prop', () => {
    const wrapper = shallowMountOption(RenameDialog, {
      propsData: { ...baseProps, hint: 'a real hint' }
    });

    expect(wrapper.vm.hint).toBe('');
  });

  test('re-syncs renameFormat whenever the value prop changes', async () => {
    const wrapper = shallowMountOption(RenameDialog, { propsData: baseProps });

    wrapper.setProps({ value: 'updated' });
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.renameFormat).toBe('updated');
  });

  test('mirrors the show prop into showDialog, and showDialog back out as update:show', async () => {
    const wrapper = shallowMountOption(RenameDialog, { propsData: { ...baseProps, show: false } });

    wrapper.setProps({ show: true });
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.showDialog).toBe(true);
    expect(wrapper.emitted('update:show')).toEqual([[true]]);
  });

  test('updateRenameFormat falls back to defaultValue when the field was cleared, and emits input', () => {
    const wrapper = shallowMountOption(RenameDialog, { propsData: baseProps });

    wrapper.vm.renameFormat = '';
    wrapper.vm.updateRenameFormat();

    expect(wrapper.vm.renameFormat).toBe('{id}_{title}');
    expect(wrapper.emitted('input')).toEqual([['{id}_{title}']]);
  });

  test('updateRenameFormat emits whatever was typed when it is not empty', () => {
    const wrapper = shallowMountOption(RenameDialog, { propsData: baseProps });

    wrapper.vm.renameFormat = 'custom_{id}';
    wrapper.vm.updateRenameFormat();

    expect(wrapper.emitted('input')).toEqual([['custom_{id}']]);
  });

  test('pickMeta inserts the holder at the cursor and moves the cursor past it', () => {
    jest.useFakeTimers();

    const wrapper = shallowMountOption(RenameDialog, { propsData: baseProps });
    const fakeInput = { focus: jest.fn(), setSelectionRange: jest.fn() };
    wrapper.vm.$refs.renameInput = { $refs: { input: fakeInput } };
    wrapper.vm.inputPos = 3;
    wrapper.vm.renameFormat = 'foo_bar';

    wrapper.vm.pickMeta({ holder: '{id}' });

    expect(wrapper.vm.renameFormat).toBe('foo{id}_bar');

    jest.runAllTimers();

    expect(fakeInput.focus).toHaveBeenCalled();
    expect(fakeInput.setSelectionRange).toHaveBeenCalledWith(7, 7);
    expect(wrapper.vm.inputPos).toBe(7);

    jest.useRealTimers();
  });
});
