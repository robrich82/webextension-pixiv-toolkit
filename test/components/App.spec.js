import { deserialize, serialize } from 'v8';
import { reactive } from 'vue';
import mitt from 'mitt';
import { flushPromises, mount, shallowMount } from '@vue/test-utils';
import browser from '@/modules/Extension/browser';
import App from '@/content_scripts/components/App.vue';
import DownloadTaskObserver from '@/content_scripts/modules/DownloadTaskObserver';
import { fakeResource } from '../helpers/fakeResource';

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

// The same mitt-backed bus UIApplication installs.
const installEventBus = () => {
  const emitter = mitt();
  window.$eventBus = { $on: emitter.on, $off: emitter.off, $emit: emitter.emit };
};

// Answers runtime messages by action, with a value or a function of the
// message; unlisted actions resolve to undefined.
const respondTo = responses => {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action in responses) {
      const response = responses[message.action];
      sendResponse(typeof response === 'function' ? response(message) : response);
    }
  });
};

const sentMessages = action => browser.runtime.sendMessage.mock.calls
  .map(([message]) => message)
  .filter(message => message.action === action);

const mountLive = () => {
  installEventBus();

  return mount(App, { global: { mocks: { tl: key => key, browserItems: { guideShowed: true } } } });
};

const mountWithPage = async resourceOptions => {
  const wrapper = mountLive();

  window.$app = { resource: fakeResource(resourceOptions) };
  window.$eventBus.$emit('pagechange', { url: window.$app.resource.getUrl(), type: 'illust' });
  await flushPromises();

  return wrapper;
};

const actionButtons = wrapper => wrapper.findAll('.ptk__action__wrapper__body > a');
const actionLabels = wrapper => actionButtons(wrapper).map(a => a.text());
const observerPort = () => browser.runtime.ports.at(-1);
const ugoira = { context: { type: 'Illust', illustType: 2 } };

afterEach(() => {
  jest.restoreAllMocks();
});

describe('App page lifecycle', () => {
  test('stays hidden until a page loads', () => {
    expect(mountLive().find('.ptk__container').exists()).toBe(false);
  });

  test('a pagechange shows the panel, records the visit and checks history', async () => {
    respondTo({ 'history:checkIfDownloaded': 1700000000 });

    const wrapper = await mountWithPage();

    expect(wrapper.find('.ptk__container').exists()).toBe(true);
    expect(wrapper.find('.ptk__container').classes()).toContain('success');
    expect(sentMessages('history:itemVisit')[0].args)
      .toEqual(expect.objectContaining({ uid: 'illust:1', title: 'Title', url: 'https://www.pixiv.net/artworks/1' }));
    expect(sentMessages('history:checkIfDownloaded')).toHaveLength(1);
  });

  test('a null pagechange tears the page down again', async () => {
    const wrapper = await mountWithPage();

    window.$eventBus.$emit('pagechange', null);
    await flushPromises();

    expect(wrapper.find('.ptk__container').exists()).toBe(false);
  });

  test('a single page has no page selector; several pages do', async () => {
    expect((await mountWithPage()).find('.ptk__page-selector').exists()).toBe(false);
    expect((await mountWithPage({ pages: ['a.jpg', 'b.jpg'] })).find('.ptk__page-selector').exists()).toBe(true);
  });

  test('a page resolver fills in each selector page', async () => {
    const wrapper = await mountWithPage({
      pages: ['a', 'b'],
      pageResolver: async page => `${page}-resolved.jpg`
    });

    expect(wrapper.findComponent({ name: 'page-selector' }).vm.pages.map(p => p.page))
      .toEqual(['a-resolved.jpg', 'b-resolved.jpg']);
  });

  test('ugoira pages offer one button per format', async () => {
    const wrapper = await mountWithPage(ugoira);

    expect(actionLabels(wrapper)).toEqual([
      '_download_apng', '_download_gif', '_download_webm', '_download_mp4', '_download_custom'
    ]);
  });

  test.each([
    ['an illust', {}, ['task']],
    ['an ugoira', ugoira, ['task-gif', 'task-apng', 'task-mp4', 'task-webm', 'task-custom']]
  ])('%s observes its download task ids', async (_, resourceOptions, downloadTaskIds) => {
    await mountWithPage(resourceOptions);

    expect(observerPort().postedMessages).toEqual([{ args: { downloadTaskIds } }]);
  });

  test('download task status updates the button progress', async () => {
    const wrapper = await mountWithPage();

    observerPort().peer.postMessage({ downloadTasksStatus: [{ type: 'PIXIV_ILLUST', progress: 0.5 }] });
    await flushPromises();

    expect(actionLabels(wrapper)).toEqual(['_download 50.00%']);
  });

  test('ugoira task status updates the matching format button', async () => {
    const wrapper = await mountWithPage(ugoira);

    observerPort().peer.postMessage({
      downloadTasksStatus: [
        { type: 'PIXIV_UGOIRA', convertType: 'gif', progress: 0.25, processProgress: 0 },
        { type: 'PIXIV_UGOIRA', convertType: 'mp4', progress: 1, processProgress: 0.5 },
        { type: 'PIXIV_UGOIRA', convertType: 'webm', progress: 1, processProgress: 1 }
      ]
    });
    await flushPromises();

    expect(actionLabels(wrapper)).toEqual([
      '_download_apng', '_download_gif (D:25.00%)', '_download_webm ✔', '_download_mp4 (P:50.00%)', '_download_custom'
    ]);
  });

  test('a finished ugoira conversion marks the panel as downloaded', async () => {
    const wrapper = await mountWithPage(ugoira);

    observerPort().peer.postMessage({
      downloadTasksStatus: [{ type: 'PIXIV_UGOIRA', convertType: 'gif', progress: 1, processProgress: 1 }]
    });
    await flushPromises();

    expect(wrapper.find('.ptk__container').classes()).toContain('success');
  });

  test('unmounting stops observing download tasks', async () => {
    const stopObserve = jest.spyOn(DownloadTaskObserver.getObserver(), 'stopObserve');
    const wrapper = await mountWithPage();

    wrapper.unmount();

    expect(stopObserve).toHaveBeenCalled();
  });
});

describe('App download', () => {
  const clickAndFlush = async button => {
    await button.trigger('click');
    await flushPromises();
  };

  const addsDownloads = { 'download:ensureDownloadManagerOpen': true, 'download:addDownload': { result: true } };

  test('adds the download and records it in history', async () => {
    respondTo({ 'download:getDownloadManagerTab': true, ...addsDownloads });
    const wrapper = await mountWithPage();

    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(sentMessages('download:addDownload')[0].args).toEqual({
      unpackedResource: { type: 'Illust' },
      options: { selectedIndexes: [], redownload: false }
    });
    expect(sentMessages('history:itemDownload')).toHaveLength(1);
    expect(wrapper.find('.ptk__download-added-notice').isVisible()).toBe(true);
    expect(wrapper.find('.ptk__download-added-notice').text()).toBe('_download_added');
  });

  test('the notice hides itself after three seconds', async () => {
    jest.useFakeTimers();
    try {
      respondTo(addsDownloads);
      const wrapper = await mountWithPage();

      await clickAndFlush(actionButtons(wrapper)[0]);
      jest.advanceTimersByTime(3000);
      await flushPromises();

      expect(wrapper.find('.ptk__download-added-notice').isVisible()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test.each([
    ['_download_apng', 'apng'],
    ['_download_gif', 'gif'],
    ['_download_webm', 'webm'],
    ['_download_mp4', 'mp4'],
    ['_download_custom', undefined]
  ])('the %s button sends its convert type', async (label, ugoiraConvertType) => {
    respondTo(addsDownloads);
    const wrapper = await mountWithPage(ugoira);

    await clickAndFlush(actionButtons(wrapper).find(a => a.text() === label));

    expect(sentMessages('download:addDownload')[0].args.options.ugoiraConvertType).toBe(ugoiraConvertType);
  });

  test("the selector's own download button sends the picked pages", async () => {
    respondTo(addsDownloads);
    const wrapper = await mountWithPage({ pages: ['a.jpg', 'b.jpg'] });

    await wrapper.findAll('.ptk__page-preview')[1].trigger('click');
    await clickAndFlush(wrapper.findAll('.ptk__dialog-foot a').find(a => a.text() === '_download'));

    expect(sentMessages('download:addDownload')[0].args.options.selectedIndexes).toEqual([1]);
  });

  const existsUntilRedownload = {
    'download:ensureDownloadManagerOpen': true,
    'download:addDownload': message => (message.args.options.redownload
      ? { result: true }
      : { result: false, errorName: 'DownloadTaskExistsError' })
  };

  test('asks before re-adding a task that already exists', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    respondTo(existsUntilRedownload);
    const wrapper = await mountWithPage();

    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(confirm).toHaveBeenCalledWith('_the_resource_is_already_in_download_manager');
    expect(sentMessages('download:addDownload').map(message => message.args.options.redownload))
      .toEqual([false, true]);
  });

  test('declining the re-add prompt sends nothing more', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    respondTo(existsUntilRedownload);
    const wrapper = await mountWithPage();

    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(sentMessages('download:addDownload')).toHaveLength(1);
    expect(sentMessages('history:itemDownload')).toHaveLength(0);
  });

  test('alerts on any other add failure', async () => {
    const alert = jest.spyOn(window, 'alert').mockImplementation(() => {});
    respondTo({
      'download:ensureDownloadManagerOpen': true,
      'download:addDownload': { result: false, errorName: 'SomethingElse' }
    });
    const wrapper = await mountWithPage();

    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(alert).toHaveBeenCalledWith('_unkown_error: SomethingElse');
    expect(sentMessages('history:itemDownload')).toHaveLength(0);
  });

  test('tells the user when the download manager will not open', async () => {
    const wrapper = await mountWithPage();

    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(sentMessages('download:addDownload')).toHaveLength(0);
    expect(wrapper.find('.ptk__download-added-notice').isVisible()).toBe(true);
    expect(wrapper.find('.ptk__download-added-notice').text())
      .toBe('_cant_open_download_manager_please_open_manully');
  });
});
