import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import GrantPermissionsBtn from '@/options_page/components/options/GrantPermissionsBtn.vue';

const permissions = { permissions: ['tabs'], origins: [] };

describe('GrantPermissionsBtn', () => {
  test('adopts the granted state for its itemKey once mounted', () => {
    const wrapper = shallowMountOption(GrantPermissionsBtn, {
      propsData: { itemKey: 'tabsGranted', permissions },
      browserItems: { tabsGranted: true }
    });

    expect(wrapper.vm.granted).toBe(true);
  });

  test('requests the permission and persists the grant when not yet granted', async () => {
    const wrapper = shallowMountOption(GrantPermissionsBtn, {
      propsData: { itemKey: 'tabsGranted', permissions },
      browserItems: { tabsGranted: false }
    });

    wrapper.vm.buttonClickHandle();
    await browser._fake.flush();

    expect(browser.permissions.request).toHaveBeenCalledWith(permissions, expect.any(Function));
    expect(wrapper.vm.granted).toBe(true);
    expect(browser.storage.local.items.tabsGranted).toBe(true);
  });

  test('removes the permission and persists the revoke when already granted', async () => {
    browser._fake.state.grantedPermissions = { permissions: ['tabs'], origins: [] };

    const wrapper = shallowMountOption(GrantPermissionsBtn, {
      propsData: { itemKey: 'tabsGranted', permissions },
      browserItems: { tabsGranted: true }
    });

    wrapper.vm.buttonClickHandle();
    await browser._fake.flush();

    expect(browser.permissions.remove).toHaveBeenCalledWith(permissions, expect.any(Function));
    expect(wrapper.vm.granted).toBe(false);
    expect(browser.storage.local.items.tabsGranted).toBe(false);
  });
});
