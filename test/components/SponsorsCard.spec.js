import { flushPromises } from '@vue/test-utils';
import { installFakeXhr } from '../doubles/xhr';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import SponsorsCard from '@/options_page/components/SponsorsCard.vue';

describe('SponsorsCard', () => {
  let xhr;

  afterEach(() => {
    xhr.restore();
  });

  test('shows a loading line until the sponsor list arrives, then lists them', async () => {
    xhr = installFakeXhr(() => JSON.stringify([{ name: 'Alice', level: 2 }, { name: 'Bob', level: 1 }]));

    const wrapper = shallowMountOption(SponsorsCard);

    expect(wrapper.text()).toContain('Loading sponsors...');

    await flushPromises();

    expect(xhr.urls).toEqual([expect.stringMatching(/sponsors\.json$/)]);
    expect(wrapper.findAll('li').map(li => [li.text(), li.classes('sponsor__level-2')])).toEqual([
      ['Alice', true],
      ['Bob', false]
    ]);
  });

  test.each([
    ['an empty list', '[]'],
    ['a non-list', '{}']
  ])('shows the be-the-first message for %s', async (_, body) => {
    xhr = installFakeXhr(() => body);

    const wrapper = shallowMountOption(SponsorsCard);
    await flushPromises();

    expect(wrapper.find('.no-sponsor').text()).toContain('sponsor_very_first.message');
    expect(wrapper.find('li').exists()).toBe(false);
  });
});
