import { flushPromises } from '@vue/test-utils';
import browser from '../doubles/browser';
import { mountOption } from '../helpers/mountOptionComponent';
import PopupApp from '@/popup_page/App.vue';
import manifest from '@/statics/manifest.json';

const FORK = 'https://github.com/robrich82/webextension-pixiv-toolkit';

describe('popup App', () => {
  let wrapper;

  beforeEach(async () => {
    // The popup asks for the active tab on mount; a non-pixiv one keeps it from connecting.
    browser._fake.addTab({ active: true, currentWindow: true, url: 'https://example.com/' });
    wrapper = mountOption(PopupApp, { browserItems: {} });
    await flushPromises();
  });

  const click = async label => {
    const link = wrapper.findAll('a').find(a => a.text().includes(label));
    await link.trigger('click');
  };

  test('"Star it" opens this fork on GitHub', async () => {
    await click('_star_it');

    expect(browser.tabs.create).toHaveBeenLastCalledWith({ url: FORK });
  });

  test("Report issue opens this fork's issue tracker", async () => {
    await click('_report_issue');

    expect(browser.tabs.create).toHaveBeenLastCalledWith({ url: `${FORK}/issues` });
  });

  test.each([
    [0, 'works'],
    [1, 'work'],
    [2, 'works']
  ])('%i downloaded reads as "%s"', async (downloaded, noun) => {
    const counted = mountOption(PopupApp, {
      browserItems: { statIllustDownloaded: downloaded, statUgoiraDownloaded: 0, statMangaDownloaded: 0, statNovelDownloaded: 0 }
    });
    await flushPromises();

    expect(counted.vm.totalDownloaded).toBe(`<strong>${downloaded}</strong> ${noun}.message`);
  });

  describe('site access notice', () => {
    const notice = mounted => mounted.find('.host-permissions-notice');

    const mountWithOrigins = async origins => {
      browser._fake.setManifest(manifest);
      browser._fake.state.grantedPermissions.origins = origins;
      const mounted = mountOption(PopupApp, { browserItems: {} });
      await flushPromises();

      return mounted;
    };

    test('Grant asks for the manifest origins, and the notice goes once they are granted', async () => {
      const mounted = await mountWithOrigins([]);

      expect(notice(mounted).text()).toContain('_host_permissions_missing.message');

      await notice(mounted).find('a').trigger('click');
      await flushPromises();

      expect(browser.permissions.request).toHaveBeenCalledWith({ origins: manifest.host_permissions });
      expect(notice(mounted).exists()).toBe(false);
    });

    test('is not shown when every origin is granted', async () => {
      const mounted = await mountWithOrigins(manifest.host_permissions.slice());

      expect(notice(mounted).exists()).toBe(false);
    });
  });
});
