import { mount } from '@vue/test-utils';
import Dialog from '@/content_scripts/components/Dialog.vue';

describe('Dialog', () => {
  test('renders head and foot only when those slots are passed', () => {
    const withSlots = mount(Dialog, {
      props: { show: true },
      slots: { head: 'Title', default: 'Body', foot: 'Actions' }
    });
    const bodyOnly = mount(Dialog, { props: { show: true }, slots: { default: 'Body' } });

    expect(withSlots.find('.ptk__dialog-head').text()).toBe('Title');
    expect(withSlots.find('.ptk__dialog-foot').text()).toBe('Actions');
    expect(bodyOnly.find('.ptk__dialog-head').exists()).toBe(false);
    expect(bodyOnly.find('.ptk__dialog-foot').exists()).toBe(false);
    expect(bodyOnly.find('.ptk__dialog-body').text()).toBe('Body');
  });

  test('show toggles the visible modifier class', async () => {
    const wrapper = mount(Dialog, { props: { show: false } });

    expect(wrapper.classes()).not.toContain('ptk__dialog--show');

    await wrapper.setProps({ show: true });

    expect(wrapper.classes()).toContain('ptk__dialog--show');
  });

  test('a mask click closes only when closeOnMaskClick is set', async () => {
    const closing = mount(Dialog, { props: { show: true, closeOnMaskClick: true } });
    const sticky = mount(Dialog, { props: { show: true } });

    await closing.trigger('click');
    await sticky.trigger('click');

    expect(closing.emitted('update:show')).toEqual([[false]]);
    expect(sticky.emitted('update:show')).toBeUndefined();
  });

  test('a click inside the container does not reach the mask', async () => {
    const wrapper = mount(Dialog, { props: { show: true, closeOnMaskClick: true } });

    await wrapper.find('.ptk__dialog-container').trigger('click');

    expect(wrapper.emitted('update:show')).toBeUndefined();
  });
});
