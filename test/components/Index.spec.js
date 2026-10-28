import { flushPromises } from '@vue/test-utils';
import browser from '../doubles/browser';
import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import Index from '@/options_page/Index.vue';

const mountIndex = (browserItems = {}) => {
  const push = jest.fn(() => Promise.resolve());
  const wrapper = shallowMountOption(Index, {
    browserItems,
    mocks: { $router: { push } },
    global: { stubs: { 'router-view': true, 'update-notice': true, supports: true } }
  });

  return { wrapper, push };
};

// The menu items use #title slots, which shallowMount's stubs don't render, and
// declare onClick as a prop, which a stub stringifies.
const mountMenu = (browserItems = {}) => {
  const push = jest.fn(() => Promise.resolve());
  const wrapper = mountOption(Index, {
    browserItems,
    mocks: { $router: { push } },
    global: { stubs: { 'router-view': true, 'update-notice': true, supports: true, 'app-suggest': true } }
  });

  return { wrapper, push };
};

const menuItem = (wrapper, label) => wrapper.findAll('.v-list-item').find(item => item.text().includes(label));

describe('Index', () => {
  beforeEach(() => {
    window.innerWidth = 1600;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('shows the extension version in the app bar', () => {
    expect(mountIndex().wrapper.text()).toContain('Next v0.0.0');
  });

  test('the drawer is pinned on wide windows and becomes a toggled overlay on narrow ones', async () => {
    const { wrapper } = mountIndex();

    expect(wrapper.vm.drawer).toBe(true);
    expect(wrapper.find('.v-primary v-btn-stub').exists()).toBe(false);

    window.innerWidth = 1000;
    window.dispatchEvent(new Event('resize'));
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.drawerTemporary).toBe(true);
    expect(wrapper.vm.drawer).toBe(false);

    await wrapper.find('v-app-bar-stub v-btn-stub').trigger('click');
    expect(wrapper.vm.drawer).toBe(true);

    window.innerWidth = 1600;
    window.dispatchEvent(new Event('resize'));
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.drawerTemporary).toBe(false);
    expect(wrapper.find('v-app-bar-stub v-btn-stub').exists()).toBe(false);
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
    expect(menuItem(mountMenu({ enableSaveVisitHistory: false }).wrapper, '_history.message')).toBeUndefined();
  });

  test('suggests Pixiv Omina on x86 Windows, sliding it in after a second', async () => {
    jest.useFakeTimers();
    browser._fake.state.platformInfo = { os: 'win', arch: 'x86-64' };

    const { wrapper } = mountIndex();
    await flushPromises();

    const suggest = () => wrapper.find('app-suggest-stub');
    expect(suggest().exists()).toBe(true);
    expect(suggest().classes()).not.toContain('app-suggest_container--show');

    jest.advanceTimersByTime(1000);
    await wrapper.vm.$nextTick();

    expect(suggest().classes()).toContain('app-suggest_container--show');
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
});
