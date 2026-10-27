import { mount } from '@vue/test-utils';
import browser from '@/modules/Extension/browser';
import ControlPanel from '@/content_scripts/components/ControlPanel.vue';
import SuperMixin from '@/mixins/SuperMixin';

// SuperMixin's browserItems reads $root.globalBrowserItems; a global mixin's
// data() reaches the test-utils host that plays $root.
const mountPanel = ({ browserItems = {}, props = {}, slots = {} } = {}) => mount(ControlPanel, {
  props: { panelStyle: 1, panelPosition: 'center', ...props },
  slots,
  global: {
    mixins: [SuperMixin, { data: () => ({ globalBrowserItems: { guideShowed: true, ...browserItems } }) }]
  }
});

describe('ControlPanel', () => {
  afterEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  test('renders its default slot inside the action wrapper', () => {
    const wrapper = mountPanel({ slots: { default: '<a class="action">Download</a>' } });

    expect(wrapper.find('.ptk__action__wrapper__body .action').text()).toBe('Download');
  });

  test('starts collapsed unless the panel auto-activates', () => {
    const collapsed = mountPanel();
    const open = mountPanel({ browserItems: { autoActivateDownloadPanel: true } });

    expect(collapsed.find('.ptk__container__body').classes()).toContain('ptk__container__body--collapse');
    expect(open.find('.ptk__container__body').classes()).not.toContain('ptk__container__body--collapse');
  });

  test('style and position props become container modifier classes', () => {
    const wrapper = mountPanel({ props: { panelStyle: 2, panelPosition: 'right' } });

    expect(wrapper.classes()).toEqual(expect.arrayContaining([
      'ptk__container--type-2',
      'ptk__container--position-right'
    ]));
  });

  test('the style-1 handler toggles the panel and dismisses the guide', async () => {
    const wrapper = mountPanel({ browserItems: { downloadPanelStyle: 1 } });

    await wrapper.find('#ptk__new-handler').trigger('click');

    expect(wrapper.find('.ptk__container__body').classes()).not.toContain('ptk__container__body--collapse');
    expect(browser.storage.local.set).toHaveBeenCalledWith({ guideShowed: true });

    await wrapper.find('#ptk__new-handler').trigger('click');

    expect(wrapper.find('.ptk__container__body').classes()).toContain('ptk__container__body--collapse');
  });

  test('with an error the handler alerts instead of toggling', async () => {
    const alert = jest.spyOn(window, 'alert').mockImplementation(() => {});
    const wrapper = mountPanel({
      browserItems: { downloadPanelStyle: 1 },
      props: { lastError: 'boom' }
    });

    await wrapper.find('#ptk__new-handler').trigger('click');

    expect(alert).toHaveBeenCalledWith('Error: boom, try refresh.');
    expect(wrapper.find('#ptk__new-handler-cross').exists()).toBe(true);
    expect(wrapper.find('.ptk__container__body').classes()).toContain('ptk__container__body--collapse');
  });

  test.each([
    ['left', '.ptk__inline-handler:not(.ptk__inline-handler--right)'],
    ['center', '.ptk__inline-handler:not(.ptk__inline-handler--right)'],
    ['right', '.ptk__inline-handler--right']
  ])('the style-2 inline handler sits on the %s side and toggles the panel', async (position, selector) => {
    const wrapper = mountPanel({
      browserItems: { downloadPanelStyle: 2, downloadPanelPosition: position }
    });

    expect(wrapper.findAll('.ptk__inline-handler')).toHaveLength(1);

    await wrapper.find(selector).trigger('click');

    expect(wrapper.find('.ptk__container__body').classes()).not.toContain('ptk__container__body--collapse');
  });

  test('shows the guide until it has been dismissed', () => {
    expect(mountPanel({ browserItems: { guideShowed: false } }).find('.ptk__guide').exists()).toBe(true);
    expect(mountPanel().find('.ptk__guide').exists()).toBe(false);
  });

  test('follows the page theme', async () => {
    const switchTheme = async theme => {
      window.localStorage.setItem('theme', theme);
      window.dispatchEvent(new Event('storage'));
      await wrapper.vm.$nextTick();
    };

    window.localStorage.setItem('theme', 'dark');

    const wrapper = mountPanel();

    expect(wrapper.attributes('id')).toBe('ptk-theme__dark');

    await switchTheme('light');
    expect(wrapper.attributes('id')).toBe('');

    await switchTheme('dark');
    expect(wrapper.attributes('id')).toBe('ptk-theme__dark');
  });
});
