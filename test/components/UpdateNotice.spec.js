import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import UpdateNotice from '@/options_page/components/UpdateNotice.vue';

// The sponsors card and change log fetch over XHR on mount; neither is under test.
const mountNotice = browserItems => shallowMountOption(UpdateNotice, {
  browserItems,
  global: { stubs: { 'sponsors-card': true, 'change-log': true, 'new-settings': true } }
});

describe('UpdateNotice', () => {
  test('opens after an update, until the change log has been dismissed', () => {
    expect(mountNotice({ showUpdateChangeLog: false }).vm.show).toBe(true);
    expect(mountNotice({ showUpdateChangeLog: true }).vm.show).toBe(false);
  });

  test('closing it hides the dialog and remembers the dismissal', async () => {
    const wrapper = mountNotice({ showUpdateChangeLog: false });

    await wrapper.findAll('v-btn-stub, .v-btn').at(-1).trigger('click');

    expect(wrapper.vm.show).toBe(false);
    expect(browser.storage.local.set).toHaveBeenCalledWith({ showUpdateChangeLog: true });
  });
});
