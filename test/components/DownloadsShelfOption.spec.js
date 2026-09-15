import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import DownloadsShelfOption from '@/options_page/components/options/DownloadsShelfOption.vue';

describe('DownloadsShelfOption', () => {
  test('adopts the stored value and does not re-check permissions when disabled', () => {
    const wrapper = shallowMountOption(DownloadsShelfOption, {
      browserItems: { disableDownloadsShelf: false }
    });

    expect(wrapper.vm.disableDownloadsShelf).toBe(false);
    expect(browser.permissions.contains).not.toHaveBeenCalled();
  });

  test('re-verifies the permission when created with the option already on', async () => {
    browser._fake.state.grantedPermissions = {
      permissions: ['downloads', 'downloads.shelf'],
      origins: []
    };

    const wrapper = shallowMountOption(DownloadsShelfOption, {
      browserItems: { disableDownloadsShelf: true }
    });

    expect(browser.permissions.contains).toHaveBeenCalledWith(
      { permissions: ['downloads', 'downloads.shelf'] },
      expect.any(Function)
    );

    await browser._fake.flush();

    expect(wrapper.vm.disableDownloadsShelf).toBe(true);
    // The permission check always writes the option back off, regardless of
    // what it found — re-enabling it is left to onDisableDownloadsShelf.
    expect(browser.storage.local.items.disableDownloadsShelf).toBe(false);
  });

  test('turning the switch on requests the permission and reflects the grant', async () => {
    const wrapper = shallowMountOption(DownloadsShelfOption, {
      browserItems: { disableDownloadsShelf: false }
    });

    wrapper.vm.onDisableDownloadsShelf(true);
    await browser._fake.flush();

    expect(browser.permissions.request).toHaveBeenCalledWith(
      { permissions: ['downloads', 'downloads.shelf'] },
      expect.any(Function)
    );
    expect(wrapper.vm.disableDownloadsShelf).toBe(true);
  });

  test('turning the switch off clears it without touching permissions', () => {
    const wrapper = shallowMountOption(DownloadsShelfOption, {
      browserItems: { disableDownloadsShelf: true }
    });

    wrapper.vm.onDisableDownloadsShelf(false);

    expect(wrapper.vm.disableDownloadsShelf).toBe(false);
    expect(browser.permissions.request).not.toHaveBeenCalled();
  });

  test('persists every change of the switch to storage', async () => {
    const wrapper = shallowMountOption(DownloadsShelfOption, {
      browserItems: { disableDownloadsShelf: false }
    });

    wrapper.vm.disableDownloadsShelf = true;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.disableDownloadsShelf).toBe(true);
  });
});
