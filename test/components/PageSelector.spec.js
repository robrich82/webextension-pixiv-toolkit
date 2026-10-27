import { shallowMount } from '@vue/test-utils';
import PageSelector from '@/content_scripts/components/PageSelector.vue';

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
});
