import { mount, shallowMount } from '@vue/test-utils';
import PageSelector from '@/content_scripts/components/PageSelector.vue';

const mountSelector = (items = ['a.jpg', 'b.jpg', 'c.jpg']) => mount(PageSelector, {
  props: { items },
  global: { mocks: { tl: key => key } }
});

const footButton = (wrapper, key) => wrapper.findAll('.ptk__dialog-foot a').find(a => a.text() === key);

describe('PageSelector', () => {
  test('updatePage swaps the url but keeps the selected state', () => {
    const wrapper = shallowMount(PageSelector, {
      props: { items: ['a.jpg', 'b.jpg'] },
      global: { mocks: { tl: key => key } }
    });

    wrapper.vm.selectPage(1);
    wrapper.vm.updatePage(1, 'c.jpg');

    expect(wrapper.vm.pages[1]).toEqual({ page: 'c.jpg', selected: true });
    expect(wrapper.vm.pages[0]).toEqual({ page: 'a.jpg', selected: false });
  });

  test('selectAll does not duplicate indexes when called repeatedly', () => {
    const wrapper = shallowMount(PageSelector, {
      props: { items: ['a.jpg', 'b.jpg'] },
      global: { mocks: { tl: key => key } }
    });

    wrapper.vm.selectAll();
    wrapper.vm.selectAll();

    expect(wrapper.vm.selectedPageIndexes).toEqual([0, 1]);
  });

  test('passes its head and foot templates into the dialog slots', () => {
    const wrapper = mountSelector();

    expect(wrapper.find('.ptk__dialog-head').text()).toBe('_select_pages_you_want_to_download');
    expect(wrapper.findAll('.ptk__dialog-foot a').map(a => a.text()))
      .toEqual(['_select_all', '_unselect_all', '_select_invert', '_download', '_close']);
  });

  test('the toggle button opens the dialog and close shuts it', async () => {
    const wrapper = mountSelector();
    const dialog = wrapper.find('.ptk__dialog');

    expect(dialog.classes()).not.toContain('ptk__dialog--show');

    await wrapper.find('.ptk__page-selector > a').trigger('click');
    expect(dialog.classes()).toContain('ptk__dialog--show');

    await footButton(wrapper, '_close').trigger('click');
    expect(dialog.classes()).not.toContain('ptk__dialog--show');
  });

  test('clicking a preview toggles it and emits the selection', async () => {
    const wrapper = mountSelector();
    const previews = wrapper.findAll('.ptk__page-preview');

    // The emitted indexes array and page objects are live state, so check per click.
    await previews[1].trigger('click');
    expect(previews[1].classes()).toContain('ptk__page-preview--selected');
    expect(wrapper.emitted('select').at(-1)).toEqual([[{ page: 'b.jpg', selected: true }], [1]]);

    await previews[1].trigger('click');
    expect(previews[1].classes()).not.toContain('ptk__page-preview--selected');
    expect(wrapper.emitted('select').at(-1)).toEqual([[], []]);
  });

  test('select all, invert and unselect all keep pages and indexes in step', async () => {
    const wrapper = mountSelector();

    await wrapper.findAll('.ptk__page-preview')[0].trigger('click');
    await footButton(wrapper, '_select_invert').trigger('click');
    expect(wrapper.vm.selectedPageIndexes).toEqual([1, 2]);
    expect(wrapper.vm.pages.map(p => p.selected)).toEqual([false, true, true]);

    await footButton(wrapper, '_select_all').trigger('click');
    expect(wrapper.vm.selectedPageIndexes).toEqual([0, 1, 2]);

    await footButton(wrapper, '_unselect_all').trigger('click');
    expect(wrapper.vm.selectedPageIndexes).toEqual([]);
    expect(wrapper.findAll('.ptk__page-preview--selected')).toHaveLength(0);
  });

  test('download is disabled until a page is selected, then emits the indexes', async () => {
    const wrapper = mountSelector();

    await footButton(wrapper, '_download').trigger('click');
    expect(wrapper.emitted('download')).toBeUndefined();

    await wrapper.findAll('.ptk__page-preview')[2].trigger('click');
    await footButton(wrapper, '_download').trigger('click');
    expect(wrapper.emitted('download')).toEqual([[{ selectedPageIndexes: [2] }]]);
  });

  test('new items replace the pages, unselected', async () => {
    const wrapper = mountSelector();

    wrapper.vm.selectPage(0);
    await wrapper.setProps({ items: ['x.jpg'] });

    expect(wrapper.vm.pages).toEqual([{ page: 'x.jpg', selected: false }]);
  });

  // The items watcher rebuilds pages but keeps selectedPageIndexes, so moving
  // between two multi-page works carries the old picks over. Remove
  // `.failing` once that's fixed.
  test.failing('new items clear the selected indexes', async () => {
    const wrapper = mountSelector();

    wrapper.vm.selectPage(0);
    await wrapper.setProps({ items: ['x.jpg'] });

    expect(wrapper.vm.selectedPageIndexes).toEqual([]);
  });
});
