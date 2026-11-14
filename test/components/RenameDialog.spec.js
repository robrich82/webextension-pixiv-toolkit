import { flushPromises } from '@vue/test-utils';
import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import RenameDialog from '@/options_page/components/options/RenameDialog.vue';

const metas = [
  { title: 'Id', holder: '{id}' },
  { title: 'Title', holder: '{title}' }
];

const baseProps = {
  title: 'Rename',
  metas,
  modelValue: 'foo_bar',
  defaultValue: '{id}_{title}'
};

describe('RenameDialog', () => {
  test('adopts the value prop as the rename format on creation', () => {
    const wrapper = shallowMountOption(RenameDialog, { propsData: baseProps });

    expect(wrapper.vm.renameFormat).toBe('foo_bar');
  });

  test('passes the hint prop through to the text field, always shown', () => {
    const wrapper = shallowMountOption(RenameDialog, {
      propsData: { ...baseProps, hint: 'a real hint' }
    });
    const field = wrapper.findComponent({ name: 'VTextField' });

    expect(field.props('hint')).toBe('a real hint');
    expect(field.props('persistentHint')).toBe(true);
  });

  test('re-syncs renameFormat whenever the value prop changes', async () => {
    const wrapper = shallowMountOption(RenameDialog, { propsData: baseProps });

    wrapper.setProps({ modelValue: 'updated' });
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
    expect(wrapper.emitted('update:modelValue')).toEqual([['{id}_{title}']]);
  });

  test('updateRenameFormat emits whatever was typed when it is not empty', () => {
    const wrapper = shallowMountOption(RenameDialog, { propsData: baseProps });

    wrapper.vm.renameFormat = 'custom_{id}';
    wrapper.vm.updateRenameFormat();

    expect(wrapper.emitted('update:modelValue')).toEqual([['custom_{id}']]);
  });

  describe('quick picks, on a real mount (#344)', () => {
    let wrapper;

    // The dialog renders its content only once open, teleported into the document.
    async function openDialog() {
      wrapper = mountOption(RenameDialog, { props: baseProps, attachTo: document.body });
      wrapper.vm.showDialog = true;
      await flushPromises();

      return document.body.querySelector('.v-overlay input');
    }

    function placeCursor(input, pos) {
      input.setSelectionRange(pos, pos);
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    }

    function pickButton(title) {
      return [...document.body.querySelectorAll('.v-overlay button')].find(b => b.textContent.trim() === title);
    }

    // setInputCursor moves the cursor in a timeout.
    async function pick(title) {
      pickButton(title).click();
      await new Promise(resolve => setTimeout(resolve));
      await flushPromises();
    }

    afterEach(() => {
      wrapper.unmount();
    });

    test('inserts each pick at the cursor and moves the cursor past it', async () => {
      const input = await openDialog();
      placeCursor(input, 3);

      await pick('Id');

      expect(input.value).toBe('foo{id}_bar');
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(7);

      await pick('Title');

      expect(input.value).toBe('foo{id}{title}_bar');
      expect(input.selectionStart).toBe(14);
    });

    test('keeps the cursor when the field is clicked outside its text', async () => {
      const input = await openDialog();
      placeCursor(input, 3);

      // The click lands on Vuetify's wrapper, which has no selectionStart.
      document.body.querySelector('.v-overlay .v-field').click();
      await pick('Id');

      expect(input.value).toBe('foo{id}_bar');
    });
  });
});
