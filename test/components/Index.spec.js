import { flushPromises } from '@vue/test-utils';
import browser from '../doubles/browser';
import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import Index from '@/options_page/Index.vue';
import manifest from '@/statics/manifest.json';

const mountIndex = (browserItems = {}, mount = shallowMountOption) => {
  const push = vi.fn(() => Promise.resolve());
  const wrapper = mount(Index, {
    browserItems,
    mocks: { $router: { push } },
    global: { stubs: { 'router-view': true, 'update-notice': true, supports: true, 'app-suggest': true } }
  });

  return { wrapper, push };
};

// A real mount: the menu items use #title slots, which shallowMount's stubs
// don't render, and declare onClick as a prop, which a stub stringifies.
const mountMenu = browserItems => mountIndex(browserItems, mountOption);

const menuItem = (wrapper, label) => wrapper.findAll('.v-list-item').find(item => item.text().includes(label));

describe('Index', () => {
  beforeEach(() => {
    window.innerWidth = 1600;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('shows the extension version in the app bar', () => {
    expect(mountIndex().wrapper.text()).toContain('Next v0.0.0');
  });

  test('the drawer is pinned on wide windows and becomes a toggled overlay on narrow ones', async () => {
    const { wrapper } = mountIndex();
    const menuButton = () => wrapper.find('v-app-bar-stub v-btn-stub');

    expect(wrapper.vm.drawer).toBe(true);
    expect(menuButton().exists()).toBe(false);

    window.innerWidth = 1000;
    window.dispatchEvent(new Event('resize'));
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.drawerTemporary).toBe(true);
    expect(wrapper.vm.drawer).toBe(false);

    await menuButton().trigger('click');
    expect(wrapper.vm.drawer).toBe(true);

    window.innerWidth = 1600;
    window.dispatchEvent(new Event('resize'));
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.drawerTemporary).toBe(false);
    expect(menuButton().exists()).toBe(false);
  });

  // Vuetify 4 stacks layout items in template order; a drawer before the app bar covers the menu button.
  test('the drawer opens below the app bar', async () => {
    const { wrapper } = mountMenu();
    await flushPromises();

    expect(wrapper.find('.v-navigation-drawer').attributes('style')).toMatch(/top: 56px/);
  });

  test('on a narrow window, a click outside the open drawer closes it', async () => {
    window.innerWidth = 1000;
    const { wrapper } = mountMenu();
    await wrapper.setData({ drawer: true });

    await wrapper.find('.v-navigation-drawer__scrim').trigger('click');

    expect(wrapper.vm.drawer).toBe(false);
  });

  test('unmounting stops listening for resizes', () => {
    const { wrapper } = mountIndex();
    wrapper.unmount();

    window.innerWidth = 1000;
    window.dispatchEvent(new Event('resize'));

    expect(wrapper.vm.drawerTemporary).toBe(false);
  });

  test.each([
    ['Options', 'settings.message'],
    ['ChangeLogs', 'Change_History.message'],
    ['Sponsors', 'Sponsors.message'],
    ['ThirdParty', 'Third_Party.message']
  ])('the menu routes to %s', async (name, label) => {
    const { wrapper, push } = mountMenu();

    await menuItem(wrapper, label).trigger('click');

    expect(push).toHaveBeenCalledWith({ name });
  });

  test('the history entry appears only while visit history is saved', async () => {
    const { wrapper, push } = mountMenu({ enableSaveVisitHistory: true });

    await menuItem(wrapper, '_history.message').trigger('click');

    expect(push).toHaveBeenCalledWith({ name: 'History' });

    const withoutHistory = mountMenu({ enableSaveVisitHistory: false }).wrapper;
    expect(menuItem(withoutHistory, '_history.message')).toBeUndefined();
  });

  test('suggests Pixiv Omina on x86 Windows, sliding it in after a second', async () => {
    vi.useFakeTimers();
    browser._fake.state.platformInfo = { os: 'win', arch: 'x86-64' };

    const { wrapper } = mountIndex();
    await flushPromises();

    const suggest = () => wrapper.find('app-suggest-stub');
    expect(suggest().exists()).toBe(true);
    expect(suggest().classes()).not.toContain('app-suggest_container--show');

    vi.advanceTimersByTime(1000);
    await wrapper.vm.$nextTick();

    expect(suggest().classes()).toContain('app-suggest_container--show');
  });

  test('closing the Pixiv Omina suggestion hides it and remembers the dismissal', async () => {
    browser._fake.state.platformInfo = { os: 'win', arch: 'x86-64' };

    const { wrapper } = mountIndex();
    await flushPromises();

    wrapper.findComponent({ name: 'app-suggest' }).vm.$emit('close');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('app-suggest-stub').exists()).toBe(false);
    expect(browser.storage.local.items).toMatchObject({ appSuggestDismissed: true });
  });

  test('does not suggest Pixiv Omina once dismissed', async () => {
    browser._fake.state.platformInfo = { os: 'win', arch: 'x86-64' };

    const { wrapper } = mountIndex({ appSuggestDismissed: true });
    await flushPromises();

    expect(wrapper.find('app-suggest-stub').exists()).toBe(false);
  });

  test.each([
    [{ os: 'win', arch: 'arm' }],
    [{ os: 'mac', arch: 'x86-64' }]
  ])('does not suggest Pixiv Omina on %o', async platformInfo => {
    browser._fake.state.platformInfo = platformInfo;

    const { wrapper } = mountIndex();
    await flushPromises();

    expect(wrapper.find('app-suggest-stub').exists()).toBe(false);
  });

  describe('download manager link', () => {
    const clickDownloadManager = async wrapper => {
      await menuItem(wrapper, '_download_manager.message').trigger('click');
      await flushPromises();
    };

    test('focuses the open download manager tab', async () => {
      browser._fake.addTab({ id: 7, windowId: 3 });
      browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'download:getDownloadManagerTab') {
          sendResponse({ id: 7, windowId: 3 });
        }
      });

      await clickDownloadManager(mountMenu().wrapper);

      expect(browser.windows.update).toHaveBeenCalledWith(3, { focused: true });
      expect(browser.tabs.update).toHaveBeenCalledWith(7, { active: true });
      expect(browser.tabs.create).not.toHaveBeenCalled();
    });

    test('opens a new download manager tab when none is open', async () => {
      await clickDownloadManager(mountMenu().wrapper);

      expect(browser.tabs.create).toHaveBeenCalledWith({
        url: expect.stringMatching(/options_page\/downloads\.html$/),
        active: true
      });
    });

    test('opens a new tab when the background is not listening', async () => {
      browser.runtime.sendMessage.mockRejectedValueOnce(new Error('Receiving end does not exist.'));

      await clickDownloadManager(mountMenu().wrapper);

      expect(browser.tabs.create).toHaveBeenCalledTimes(1);
    });

    test('ignores clicks while a previous one is still opening', async () => {
      const { wrapper } = mountMenu();
      const link = menuItem(wrapper, '_download_manager.message');

      await link.trigger('click');
      await link.trigger('click');
      await flushPromises();

      expect(browser.tabs.create).toHaveBeenCalledTimes(1);

      await link.trigger('click');
      await flushPromises();

      expect(browser.tabs.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('site access notice', () => {
    const notice = wrapper => wrapper.find('.host-permissions-notice');

    beforeEach(() => {
      browser._fake.setManifest(manifest);
    });

    test('asks for the manifest origins while any is missing, and hides once granted', async () => {
      browser._fake.state.grantedPermissions.origins = manifest.host_permissions.slice(1);
      const { wrapper } = mountMenu();
      await flushPromises();

      expect(notice(wrapper).text()).toContain('_host_permissions_missing.message');

      await notice(wrapper).find('button').trigger('click');
      await flushPromises();

      expect(browser.permissions.request).toHaveBeenCalledWith({ origins: manifest.host_permissions });
      expect(notice(wrapper).exists()).toBe(false);
    });

    // Firefox and Chrome only allow the request inside the click's own task.
    test('asks in the same tick as the click', async () => {
      const { wrapper } = mountMenu();
      await flushPromises();

      notice(wrapper).find('button').element.click();

      expect(browser.permissions.request).toHaveBeenCalledWith({ origins: manifest.host_permissions });
    });

    test('stays up when the user declines', async () => {
      browser.permissions.request.mockResolvedValueOnce(false);
      const { wrapper } = mountMenu();
      await flushPromises();

      await notice(wrapper).find('button').trigger('click');
      await flushPromises();

      expect(notice(wrapper).exists()).toBe(true);
    });

    test('is not shown when every origin is granted', async () => {
      browser._fake.state.grantedPermissions.origins = manifest.host_permissions.slice();
      const { wrapper } = mountMenu();
      await flushPromises();

      expect(notice(wrapper).exists()).toBe(false);
    });

    test('follows grants and revokes made elsewhere until unmounted', async () => {
      browser._fake.state.grantedPermissions.origins = manifest.host_permissions.slice();
      const { wrapper } = mountMenu();
      await flushPromises();

      await browser.permissions.remove({ origins: [manifest.host_permissions[0]] });
      await flushPromises();
      expect(notice(wrapper).exists()).toBe(true);

      await browser.permissions.request({ origins: manifest.host_permissions });
      await flushPromises();
      expect(notice(wrapper).exists()).toBe(false);

      wrapper.unmount();
      expect(browser.permissions.onAdded.hasListeners()).toBe(false);
      expect(browser.permissions.onRemoved.hasListeners()).toBe(false);
    });
  });
});
