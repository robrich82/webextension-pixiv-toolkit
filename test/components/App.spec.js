import { deserialize, serialize } from 'v8';
import { reactive } from 'vue';
import { shallowMount } from '@vue/test-utils';
import App from '@/content_scripts/components/App.vue';

// jsdom has no global structuredClone; v8's serializer is the same algorithm.
const structuredClone = value => deserialize(serialize(value));

// Firefox structured-clones runtime messages and throws DataCloneError on Vue
// reactive proxies; Chrome JSON-serializes them, so only Firefox surfaces it.
const mountApp = () => {
  window.$eventBus = { $on: jest.fn() };

  return shallowMount(App, { global: { mocks: { tl: key => key, browserItems: {} } } });
};

describe('App', () => {
  test('structuredClone rejects reactive proxies (guard for the test below)', () => {
    expect(() => structuredClone(reactive({ a: 1 }))).toThrow(/could not be cloned/);
  });

  test('getDownloadArgs returns data that survives structuredClone', () => {
    const wrapper = mountApp();

    wrapper.vm.resource = { unpack: () => ({ type: 'Illust', pages: [{ url: 'a.jpg' }] }) };
    wrapper.vm.selectedIndexes = [0, 1];

    const args = wrapper.vm.getDownloadArgs({ ugoiraConvertType: 'gif' });

    expect(structuredClone(args)).toEqual({
      unpackedResource: { type: 'Illust', pages: [{ url: 'a.jpg' }] },
      options: { ugoiraConvertType: 'gif', selectedIndexes: [0, 1] }
    });
  });
});
