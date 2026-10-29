import { mountOption } from '../helpers/mountOptionComponent';
import Supports from '@/options_page/components/Supports.vue';

const userAgents = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0'
};

// v-show's display:none; isVisible() misreads it on this detached, Vuetify-wrapped span.
const labelShown = wrapper => wrapper.find('.button-text').element.style.display !== 'none';

const resizeTo = width => {
  window.innerWidth = width;
  window.dispatchEvent(new Event('resize'));
};

describe('Supports', () => {
  let open;

  beforeEach(() => {
    open = jest.spyOn(window, 'open').mockImplementation(() => null);
    window.innerWidth = 1024;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mountAs = (browserName, props = {}, mocks = {}) => {
    jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgents[browserName]);

    return mountOption(Supports, { props, mocks });
  };

  test.each([
    ['chrome', 'https://chrome.google.com/webstore/detail/pixiv-toolkit/ajlcnbbeidbackfknkgknjefhmbngdnj'],
    ['firefox', 'https://addons.mozilla.org/en-US/firefox/addon/pixiv-toolkit/']
  ])('on %s the review button opens its store page', async (browserName, url) => {
    const buttons = mountAs(browserName).findAll('.support-btn');

    expect(buttons).toHaveLength(2);

    await buttons[1].trigger('click');

    expect(open).toHaveBeenCalledWith(url, '_blank');
  });

  test('edge has no review button', () => {
    expect(mountAs('edge').findAll('.support-btn')).toHaveLength(1);
  });

  test('the star button opens the GitHub repo', async () => {
    await mountAs('chrome').findAll('.support-btn')[0].trigger('click');

    expect(open).toHaveBeenCalledWith('https://github.com/leoding86/webextension-pixiv-toolkit', '_blank');
  });

  test('the inline sponsors link routes in-page by default', async () => {
    const push = jest.fn(() => Promise.resolve());
    const wrapper = mountAs('chrome', { showInlineSponsorsLink: true }, { $router: { push } });

    await wrapper.findAll('.support-btn')[2].trigger('click');

    expect(push).toHaveBeenCalledWith({ name: 'Sponsors' });
    expect(open).not.toHaveBeenCalled();
  });

  test('the inline sponsors link can open the sponsors page in a new tab', async () => {
    const wrapper = mountAs('chrome', { showInlineSponsorsLink: true, openSponsorsInNew: true });

    await wrapper.findAll('.support-btn')[2].trigger('click');

    expect(open).toHaveBeenCalledWith(expect.stringMatching(/options_page\/index\.html#\/sponsors$/), '_blank');
  });

  test('button labels hide below 950px wide and come back above it', async () => {
    const wrapper = mountAs('chrome');

    expect(labelShown(wrapper)).toBe(true);

    resizeTo(900);
    await wrapper.vm.$nextTick();
    expect(labelShown(wrapper)).toBe(false);

    resizeTo(1200);
    await wrapper.vm.$nextTick();
    expect(labelShown(wrapper)).toBe(true);
  });

  test('starts with labels hidden on a narrow window', async () => {
    window.innerWidth = 800;

    const wrapper = mountAs('chrome');
    await wrapper.vm.$nextTick();

    expect(labelShown(wrapper)).toBe(false);
  });
});
