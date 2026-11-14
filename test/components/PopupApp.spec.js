import { flushPromises } from '@vue/test-utils';
import browser from '../doubles/browser';
import { mountOption } from '../helpers/mountOptionComponent';
import PopupApp from '@/popup_page/App.vue';

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
});
