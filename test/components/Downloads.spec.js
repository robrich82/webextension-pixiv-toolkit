import { flushPromises } from '@vue/test-utils';
import browser from '../doubles/browser';
import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import Downloads from '@/options_page/Downloads.vue';

// The download-manager stub doesn't stop DownloadManager.vue's imports
// loading, and DownloadsApplication boots the whole app.
jest.mock('@/options_page/DownloadsApplication', () => ({ app: () => ({ getService: () => ({}) }) }));

// Downloads reads openedTabId/openedWindowId off $root, which in a test is the
// test-utils host. The $parent guard keeps them off Downloads' own same-named computeds.
const mountDownloads = ({ openedTabId = 0, openedWindowId = 0 } = {}, mount = shallowMountOption) => mount(Downloads, {
  global: {
    mixins: [{ data() { return this.$parent ? {} : { openedTabId, openedWindowId }; } }],
    stubs: { supports: true, 'download-manager': true }
  }
});

describe('Downloads', () => {
  beforeEach(() => {
    window.innerWidth = 1600;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('shows the download manager when no other manager tab is open', () => {
    const wrapper = mountDownloads();

    expect(wrapper.find('download-manager-stub').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('_download_manager_is_already_opened.message');
  });

  test('another open manager tab gets a warning instead', () => {
    const wrapper = mountDownloads({ openedTabId: 7, openedWindowId: 3 });

    expect(wrapper.find('download-manager-stub').exists()).toBe(false);
    expect(wrapper.text()).toContain('_download_manager_is_already_opened.message');
  });

  test('switching to the open manager focuses it and closes this tab', async () => {
    const close = jest.spyOn(window, 'close').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    browser._fake.addTab({ id: 7, windowId: 3 });
    const wrapper = mountDownloads({ openedTabId: 7, openedWindowId: 3 });

    await wrapper.find('a').trigger('click');
    await flushPromises();

    expect(browser.windows.update).toHaveBeenCalledWith(3, { focused: true });
    expect(browser.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(close).toHaveBeenCalled();
  });

  test('the settings entry opens the options page in a new tab', async () => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    // A real mount: v-list-item declares onClick as a prop, which a stub stringifies.
    const wrapper = mountDownloads({}, mountOption);

    await wrapper.findAll('.v-list-item').find(item => item.text().includes('_settings.message')).trigger('click');

    expect(open).toHaveBeenCalledWith(expect.stringMatching(/options_page\/index\.html$/), '_blank');
  });

  test('the drawer becomes a toggled overlay on narrow windows', async () => {
    window.innerWidth = 1000;

    const wrapper = mountDownloads();

    expect(wrapper.vm.drawerTemporary).toBe(true);
    expect(wrapper.vm.drawer).toBe(false);

    await wrapper.find('v-app-bar-stub v-btn-stub').trigger('click');

    expect(wrapper.vm.drawer).toBe(true);
  });
});
