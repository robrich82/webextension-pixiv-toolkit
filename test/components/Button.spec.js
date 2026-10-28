import { mount } from '@vue/test-utils';
import Button from '@/content_scripts/components/Button.vue';

// Mounted through a parent so `@click` is a component listener, as in the real
// templates; without `emits: ['click']` it also falls through to the root <a>
// as a native listener and fires twice.
const mountInParent = (props = {}) => {
  const onClick = jest.fn();
  const wrapper = mount({
    components: { 'ptk-button': Button },
    data: () => ({ props }),
    methods: { onClick },
    template: '<ptk-button v-bind="props" @click="onClick">Go</ptk-button>'
  });

  return { wrapper, onClick };
};

describe('Button', () => {
  test('a click reaches the parent exactly once', async () => {
    const { wrapper, onClick } = mountInParent();

    await wrapper.find('a').trigger('click');

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('a disabled button swallows clicks', async () => {
    const { wrapper, onClick } = mountInParent({ disabled: true });

    await wrapper.find('a').trigger('click');

    expect(onClick).not.toHaveBeenCalled();
    expect(wrapper.find('a').classes()).toContain('button--disabled');
  });

  test('type adds a modifier class and text is the slot fallback', () => {
    const wrapper = mount(Button, { props: { type: 'success', text: 'Save' } });

    expect(wrapper.find('a').classes()).toContain('button--success');
    expect(wrapper.text()).toBe('Save');
  });
});
