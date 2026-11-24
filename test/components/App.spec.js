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
  window.$eventBus = { $on: vi.fn() };

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

// Attached, because jsdom computes no styles for a detached element, so
// isVisible() would miss v-show's display: none.
const mounted = [];
const mountLive = (browserItems = {}) => {
  installEventBus();

  const wrapper = mount(App, {
    attachTo: document.body,
    global: { mocks: { tl: key => key, browserItems: { guideShowed: true, ...browserItems } } }
  });
  mounted.push(wrapper);
  return wrapper;
};

const mountWithPage = async (resourceOptions, browserItems) => {
  const wrapper = mountLive(browserItems);

  window.$app = { resource: fakeResource(resourceOptions) };
  window.$eventBus.$emit('pagechange', { url: window.$app.resource.getUrl(), type: 'illust' });
  await flushPromises();

  return wrapper;
};

const actionButtons = wrapper => wrapper.findAll('.ptk__action__wrapper__body > a');
const actionLabels = wrapper => actionButtons(wrapper).map(a => a.text());
const observerPort = () => browser.runtime.ports.at(-1);
const ugoira = { context: { type: 'Illust', illustType: 2 } };

beforeEach(() => {
  // jsdom may leave it out; the panel revokes its preview urls.
  URL.revokeObjectURL ??= () => {};
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  mounted.splice(0).filter(wrapper => !wrapper.vm.$.isUnmounted).forEach(wrapper => wrapper.unmount());
  vi.restoreAllMocks();
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

  // What the background answers while download history is set to Disable.
  test('a 0 from history:checkIfDownloaded leaves the panel unmarked', async () => {
    respondTo({ 'history:checkIfDownloaded': 0 });

    const wrapper = await mountWithPage();

    expect(sentMessages('history:checkIfDownloaded')).toHaveLength(1);
    expect(wrapper.find('.ptk__container').classes()).not.toContain('success');
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

  test('a page whose preview fails stays blank, and the pages after it still resolve', async () => {
    const error = new Error("Couldn't load the encrypted image");
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = await mountWithPage({
      pages: ['a', 'b', 'c'],
      pageResolver: async page => {
        if (page === 'b') {
          throw error;
        }

        return `${page}-resolved.jpg`;
      }
    });

    expect(wrapper.findComponent({ name: 'page-selector' }).vm.pages.map(p => p.page))
      .toEqual(['a-resolved.jpg', '', 'c-resolved.jpg']);
    expect(console.error).toHaveBeenCalledWith('Could not load the preview of page 2', error);
  });

  test("a previous page's resolver stops once the page changes", async () => {
    let resolveOld;
    const wrapper = await mountWithPage({
      pages: ['old-a', 'old-b'],
      pageResolver: () => new Promise(resolve => { resolveOld = resolve; })
    });

    window.$app = { resource: fakeResource({ pages: ['new-a.jpg', 'new-b.jpg'] }) };
    window.$eventBus.$emit('pagechange', { url: window.$app.resource.getUrl(), type: 'illust' });
    await flushPromises();
    resolveOld('old-a-resolved.jpg');
    await flushPromises();

    expect(wrapper.findComponent({ name: 'page-selector' }).vm.pages.map(p => p.page))
      .toEqual(['new-a.jpg', 'new-b.jpg']);
    // Nobody shows it, so it is released at once.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('old-a-resolved.jpg');
  });

  test("resolved previews are released when the page changes, and the next page's when the panel unmounts", async () => {
    const wrapper = await mountWithPage({ pages: ['a', 'b'], pageResolver: async page => `blob:${page}` });

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    window.$app = { resource: fakeResource({ pages: ['c', 'd'], pageResolver: async page => `blob:${page}` }) };
    window.$eventBus.$emit('pagechange', { url: window.$app.resource.getUrl(), type: 'illust' });
    await flushPromises();

    expect(URL.revokeObjectURL.mock.calls.flat()).toEqual(['blob:a', 'blob:b']);

    wrapper.unmount();

    expect(URL.revokeObjectURL.mock.calls.flat()).toEqual(['blob:a', 'blob:b', 'blob:c', 'blob:d']);
  });

  test('a preview that resolves after the panel unmounts is revoked, and the rest are not fetched', async () => {
    let resolveFirst;
    const pageResolver = vi.fn(() => new Promise(resolve => { resolveFirst = resolve; }));
    const wrapper = await mountWithPage({ pages: ['a', 'b'], pageResolver });

    wrapper.unmount();
    resolveFirst('blob:a');
    await flushPromises();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:a');
    expect(pageResolver).toHaveBeenCalledTimes(1);
  });

  test('ugoira pages offer one button per format', async () => {
    const wrapper = await mountWithPage(ugoira);

    expect(actionLabels(wrapper)).toEqual([
      '_download_apng', '_download_gif', '_download_webm', '_download_mp4', '_download_mkv', '_download_mov', '_download_zip'
    ]);
  });

  test.each([
    ['an illust', {}, ['task']],
    ['an ugoira', ugoira, ['task-gif', 'task-apng', 'task-mp4', 'task-webm', 'task-mkv', 'task-mov', 'task-zip']]
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

  test.each([
    ['queued', '_download 0.00%', 1],
    ['downloading', '_download 0.00%', 2],
    ['processing', '_download 0.00%', 99],
    ['paused', '_download', 3],
    ['failed', '_download ✘', -1]
  ])('a %s task at 0%% shows as %s', async (_, label, state) => {
    const wrapper = await mountWithPage();

    observerPort().peer.postMessage({ downloadTasksStatus: [{ type: 'PIXIV_ILLUST', progress: 0, state }] });
    await flushPromises();

    expect(actionLabels(wrapper)).toEqual([label]);
  });

  test('a queued ugoira format shows 0% on its own button', async () => {
    const wrapper = await mountWithPage(ugoira);

    observerPort().peer.postMessage({
      downloadTasksStatus: [
        { type: 'PIXIV_UGOIRA', convertType: 'webm', progress: 0, processProgress: 0, state: 1 },
        { type: 'PIXIV_UGOIRA', convertType: 'gif', progress: 0, processProgress: 0, state: 3 }
      ]
    });
    await flushPromises();

    expect(actionLabels(wrapper)).toEqual([
      '_download_apng', '_download_gif', '_download_webm (D:0.00%)', '_download_mp4', '_download_mkv', '_download_mov', '_download_zip'
    ]);
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
      '_download_apng', '_download_gif (D:25.00%)', '_download_webm ✔', '_download_mp4 (P:50.00%)', '_download_mkv', '_download_mov', '_download_zip'
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

  // A failed conversion kept its last D/P% or ✔ (#462).
  test('a failed ugoira task shows as failed on its button, over its progress', async () => {
    const wrapper = await mountWithPage(ugoira);

    observerPort().peer.postMessage({
      downloadTasksStatus: [
        { type: 'PIXIV_UGOIRA', convertType: 'gif', progress: 1, processProgress: 0, state: -1 },
        { type: 'PIXIV_UGOIRA', convertType: 'mp4', progress: 1, processProgress: 0.42, state: -1 },
        { type: 'PIXIV_UGOIRA', convertType: 'webm', progress: 1, processProgress: 1, state: -1 }
      ]
    });
    await flushPromises();

    expect(actionLabels(wrapper)).toEqual([
      '_download_apng', '_download_gif ✘', '_download_webm ✘', '_download_mp4 ✘', '_download_mkv', '_download_mov', '_download_zip'
    ]);
    // An encoder can report 100% before the save fails.
    expect(wrapper.find('.ptk__container').classes()).not.toContain('success');
  });

  test('unmounting stops observing download tasks', async () => {
    const stopObserve = vi.spyOn(DownloadTaskObserver.getObserver(), 'stopObserve');
    const wrapper = await mountWithPage();

    wrapper.unmount();

    expect(stopObserve).toHaveBeenCalled();
  });
});

describe('App on a restricted post', () => {
  const showRestricted = async () => {
    window.$eventBus.$emit('pagerestricted');
    await flushPromises();
  };

  test('shows the panel with a disabled locked-post message instead of download buttons (#204)', async () => {
    const wrapper = mountLive();

    await showRestricted();

    const buttons = actionButtons(wrapper);

    expect(buttons.map(a => a.text())).toEqual(['_post_restricted']);
    expect(buttons[0].classes()).toContain('button--disabled');
  });

  test('replaces a page that was already showing, Pixiv Omina button included', async () => {
    const wrapper = await mountWithPage({ pages: ['a.jpg', 'b.jpg'] }, { showPixivOmina: true });

    await showRestricted();

    expect(actionLabels(wrapper)).toEqual(['_post_restricted']);
    expect(wrapper.find('.ptk__page-selector').exists()).toBe(false);
    expect(wrapper.find('.ptk__pixiv-omina__btn').exists()).toBe(false);
  });

  test('the next pagechange brings the download button back', async () => {
    const wrapper = mountLive();

    await showRestricted();
    window.$app = { resource: fakeResource() };
    window.$eventBus.$emit('pagechange', { url: window.$app.resource.getUrl(), type: 'illust' });
    await flushPromises();

    expect(actionLabels(wrapper)).toEqual(['_download']);
  });

  test('the page before stops resolving its remaining pages', async () => {
    let resolveOld;
    const pageResolver = vi.fn(() => new Promise(resolve => { resolveOld = resolve; }));

    await mountWithPage({ pages: ['old-a', 'old-b'], pageResolver });
    await showRestricted();
    resolveOld('old-a-resolved.jpg');
    await flushPromises();

    expect(pageResolver.mock.calls).toEqual([['old-a']]);
  });

  test("the page before's download progress doesn't follow it", async () => {
    const wrapper = await mountWithPage(ugoira);
    const port = observerPort();

    port.peer.postMessage({
      downloadTasksStatus: [{ type: 'PIXIV_UGOIRA', convertType: 'gif', progress: 1, processProgress: 1 }]
    });
    await flushPromises();
    expect(wrapper.find('.ptk__container').classes()).toContain('success');

    await showRestricted();

    expect(wrapper.find('.ptk__container').classes()).not.toContain('success');
    expect(port.disconnected).toBe(true);
  });
});

describe('App download', () => {
  const clickAndFlush = async button => {
    await button.trigger('click');
    await flushPromises();
  };

  const addsDownloads = { 'download:ensureDownloadManagerOpen': true, 'download:addDownload': { result: true } };

  test('adds the download, leaving its history to the download manager', async () => {
    respondTo({ 'download:getDownloadManagerTab': true, ...addsDownloads });
    const wrapper = await mountWithPage();

    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(sentMessages('download:addDownload')[0].args).toEqual({
      unpackedResource: { type: 'Illust' },
      options: { selectedIndexes: [], redownload: false }
    });
    // Recorded once the task completes, not on enqueue (OptionsDownloadService.spec).
    expect(sentMessages('history:itemDownload')).toHaveLength(0);
    expect(wrapper.find('.ptk__download-added-notice').isVisible()).toBe(true);
    expect(wrapper.find('.ptk__download-added-notice').text()).toBe('_download_added');
    expect(actionLabels(wrapper)).toEqual(['_download 0.00%']);
  });

  // #391: the port the page opened on load predates a download manager the click opened.
  test('observes the task again over a new port once the download manager is open', async () => {
    respondTo(addsDownloads);
    const wrapper = await mountWithPage();
    const loadPort = observerPort();

    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(observerPort()).not.toBe(loadPort);
    expect(loadPort.disconnected).toBe(true);
    expect(observerPort().postedMessages).toEqual([{ args: { downloadTaskIds: ['task'] } }]);

    observerPort().peer.postMessage({ downloadTasksStatus: [{ type: 'PIXIV_ILLUST', progress: 1, state: 4 }] });
    await flushPromises();
    expect(actionLabels(wrapper)).toEqual(['_download ✔']);
  });

  test('observes again even when the task already exists and the re-add is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    respondTo({
      'download:ensureDownloadManagerOpen': true,
      'download:addDownload': { result: false, errorName: 'DownloadTaskExistsError' }
    });
    const wrapper = await mountWithPage();
    const loadPort = observerPort();

    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(observerPort()).not.toBe(loadPort);
    observerPort().peer.postMessage({ downloadTasksStatus: [{ type: 'PIXIV_ILLUST', progress: 0.5, state: 3 }] });
    await flushPromises();
    expect(actionLabels(wrapper)).toEqual(['_download 50.00%']);
  });

  test('the notice hides itself after three seconds', async () => {
    vi.useFakeTimers();
    try {
      respondTo(addsDownloads);
      const wrapper = await mountWithPage();

      const notice = () => wrapper.find('.ptk__download-added-notice');
      expect(notice().isVisible()).toBe(false);

      await clickAndFlush(actionButtons(wrapper)[0]);
      await vi.advanceTimersByTimeAsync(2999);
      await wrapper.vm.$nextTick();
      expect(notice().isVisible()).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      await wrapper.vm.$nextTick();
      expect(notice().isVisible()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([
    ['_download_apng', 'apng'],
    ['_download_gif', 'gif'],
    ['_download_webm', 'webm'],
    ['_download_mp4', 'mp4'],
    ['_download_mkv', 'mkv'],
    ['_download_mov', 'mov'],
    ['_download_zip', 'zip']
  ])('the %s button sends its convert type', async (label, ugoiraConvertType) => {
    respondTo(addsDownloads);
    const wrapper = await mountWithPage(ugoira);

    await clickAndFlush(actionButtons(wrapper).find(a => a.text() === label));

    expect(sentMessages('download:addDownload')[0].args.options.ugoiraConvertType).toBe(ugoiraConvertType);
    // Only the clicked button shows its task's progress.
    expect(actionLabels(wrapper).filter(text => text.endsWith('(D:0.00%)'))).toEqual([`${label} (D:0.00%)`]);
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
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    respondTo(existsUntilRedownload);
    const wrapper = await mountWithPage();

    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(confirm).toHaveBeenCalledWith('_the_resource_is_already_in_download_manager');
    expect(sentMessages('download:addDownload').map(message => message.args.options.redownload))
      .toEqual([false, true]);
  });

  // A cached re-download can finish between two status updates, which kept the old tick on the button throughout.
  test('a re-download replaces the finished tick with 0% straight away', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    respondTo(existsUntilRedownload);
    const wrapper = await mountWithPage();

    observerPort().peer.postMessage({ downloadTasksStatus: [{ type: 'PIXIV_ILLUST', progress: 1, state: 4 }] });
    await flushPromises();
    expect(actionLabels(wrapper)).toEqual(['_download ✔']);

    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(actionLabels(wrapper)).toEqual(['_download 0.00%']);

    observerPort().peer.postMessage({ downloadTasksStatus: [{ type: 'PIXIV_ILLUST', progress: 1, state: 4 }] });
    await flushPromises();
    expect(actionLabels(wrapper)).toEqual(['_download ✔']);
  });

  test('a re-download of one ugoira format resets only that button', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    respondTo(existsUntilRedownload);
    const wrapper = await mountWithPage(ugoira);

    observerPort().peer.postMessage({
      downloadTasksStatus: [
        { type: 'PIXIV_UGOIRA', convertType: 'gif', progress: 1, processProgress: 1, state: 4 },
        { type: 'PIXIV_UGOIRA', convertType: 'mp4', progress: 1, processProgress: 1, state: 4 }
      ]
    });
    await flushPromises();

    await clickAndFlush(actionButtons(wrapper).find(a => a.text() === '_download_gif ✔'));

    expect(actionLabels(wrapper)).toEqual([
      '_download_apng', '_download_gif (D:0.00%)', '_download_webm', '_download_mp4 ✔', '_download_mkv', '_download_mov', '_download_zip'
    ]);
  });

  test.each([
    ['an ugoira format', ugoira, { type: 'PIXIV_UGOIRA', convertType: 'gif', progress: 1, processProgress: 0.5, state: -1 }, '_download_gif ✘', 1, '_download_gif (D:0.00%)'],
    ['a work', undefined, { type: 'PIXIV_ILLUST', progress: 0.5, state: -1 }, '_download ✘', 0, '_download 0.00%']
  ])('clicking a failed %s retries it without asking', async (_, resourceOptions, status, failedLabel, index, queuedLabel) => {
    const confirm = vi.spyOn(window, 'confirm');
    respondTo(existsUntilRedownload);
    const wrapper = await mountWithPage(resourceOptions);

    observerPort().peer.postMessage({ downloadTasksStatus: [status] });
    await flushPromises();
    expect(actionLabels(wrapper)[index]).toBe(failedLabel);

    await clickAndFlush(actionButtons(wrapper)[index]);

    expect(confirm).not.toHaveBeenCalled();
    expect(sentMessages('download:addDownload').map(message => message.args.options.redownload)).toEqual([true]);
    expect(actionLabels(wrapper)[index]).toBe(queuedLabel);
  });

  test('retrying a failed task the download manager no longer holds adds it afresh', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    respondTo({
      'download:ensureDownloadManagerOpen': true,
      'download:addDownload': message => (message.args.options.redownload
        ? { result: false, errorName: 'DownloadTaskNotFoundError' }
        : { result: true })
    });
    const wrapper = await mountWithPage();

    observerPort().peer.postMessage({ downloadTasksStatus: [{ type: 'PIXIV_ILLUST', progress: 0, state: -1 }] });
    await flushPromises();
    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(sentMessages('download:addDownload').map(message => message.args.options.redownload)).toEqual([true, false]);
    expect(actionLabels(wrapper)).toEqual(['_download 0.00%']);
    expect(alert).not.toHaveBeenCalled();
  });

  test('a failed add leaves the button as it was', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    respondTo({
      'download:ensureDownloadManagerOpen': true,
      'download:addDownload': { result: false, errorName: 'SomethingElse' }
    });
    const wrapper = await mountWithPage();

    observerPort().peer.postMessage({ downloadTasksStatus: [{ type: 'PIXIV_ILLUST', progress: 1, state: 4 }] });
    await flushPromises();
    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(actionLabels(wrapper)).toEqual(['_download ✔']);
  });

  test('re-downloading a task that is still running leaves its progress alone', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    respondTo({
      'download:getDownloadManagerTab': true,
      'download:ensureDownloadManagerOpen': true,
      'download:addDownload': { result: false, errorName: 'DownloadTaskExistsError' }
    });
    const wrapper = await mountWithPage();

    observerPort().peer.postMessage({ downloadTasksStatus: [{ type: 'PIXIV_ILLUST', progress: 0.4, state: 3 }] });
    await flushPromises();
    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(sentMessages('download:addDownload').map(message => message.args.options.redownload))
      .toEqual([false, true]);
    expect(actionLabels(wrapper)).toEqual(['_download 40.00%']);
    expect(wrapper.find('.ptk__download-added-notice').isVisible()).toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });

  test('a re-download that fails alerts and leaves the button', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    respondTo({
      'download:getDownloadManagerTab': true,
      'download:ensureDownloadManagerOpen': true,
      'download:addDownload': message => (message.args.options.redownload
        ? { result: false, errorName: 'Error' }
        : { result: false, errorName: 'DownloadTaskExistsError' })
    });
    const wrapper = await mountWithPage();

    observerPort().peer.postMessage({ downloadTasksStatus: [{ type: 'PIXIV_ILLUST', progress: 1, state: 4 }] });
    await flushPromises();
    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(alert).toHaveBeenCalledWith('_unknown_error: Error');
    expect(actionLabels(wrapper)).toEqual(['_download ✔']);
    expect(wrapper.find('.ptk__download-added-notice').isVisible()).toBe(false);
  });

  // Deleted in the download manager while the confirm was up: there is nothing to replace, so it's added afresh.
  test('a confirmed re-download of a task the download manager no longer holds adds it again', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let added = false;
    respondTo({
      'download:getDownloadManagerTab': true,
      'download:ensureDownloadManagerOpen': true,
      'download:addDownload': message => {
        if (message.args.options.redownload) {
          return { result: false, errorName: 'DownloadTaskNotFoundError' };
        }

        const response = added ? { result: true } : { result: false, errorName: 'DownloadTaskExistsError' };
        added = true;
        return response;
      }
    });
    const wrapper = await mountWithPage();

    observerPort().peer.postMessage({ downloadTasksStatus: [{ type: 'PIXIV_ILLUST', progress: 1, state: 4 }] });
    await flushPromises();
    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(sentMessages('download:addDownload').map(message => message.args.options.redownload))
      .toEqual([false, true, false]);
    expect(alert).not.toHaveBeenCalled();
    expect(actionLabels(wrapper)).toEqual(['_download 0.00%']);
  });

  test('a failed task at 100% shows as failed on the download button', async () => {
    const wrapper = await mountWithPage();

    observerPort().peer.postMessage({ downloadTasksStatus: [{ type: 'PIXIV_ILLUST', progress: 1, state: -1 }] });
    await flushPromises();

    expect(actionLabels(wrapper)).toEqual(['_download ✘']);
  });

  // A zip task is done processing as soon as the zip is saved.
  test('the zip ugoira button follows its task, and a saved zip marks the panel as downloaded', async () => {
    respondTo(addsDownloads);
    const wrapper = await mountWithPage(ugoira);
    const zip = () => actionLabels(wrapper).find(label => label.startsWith('_download_zip'));

    await clickAndFlush(actionButtons(wrapper).find(a => a.text() === '_download_zip'));
    expect(zip()).toBe('_download_zip (D:0.00%)');

    observerPort().peer.postMessage({
      downloadTasksStatus: [{ type: 'PIXIV_UGOIRA', convertType: 'zip', progress: 1, processProgress: 1, state: 4 }]
    });
    await flushPromises();

    expect(zip()).toBe('_download_zip ✔');
    expect(wrapper.find('.ptk__container').classes()).toContain('success');
  });

  test.each([
    ['paused', 3, '_download'],
    ['failed', -1, '_download ✘']
  ])('a %s task clears the queued 0%%', async (_, state, label) => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    respondTo(existsUntilRedownload);
    const wrapper = await mountWithPage();

    await clickAndFlush(actionButtons(wrapper)[0]);
    expect(actionLabels(wrapper)).toEqual(['_download 0.00%']);

    observerPort().peer.postMessage({ downloadTasksStatus: [{ type: 'PIXIV_ILLUST', progress: 0, state }] });
    await flushPromises();

    expect(actionLabels(wrapper)).toEqual([label]);
  });

  const showNextPage = async resourceOptions => {
    window.$app = { resource: fakeResource(resourceOptions) };
    window.$eventBus.$emit('pagechange', { url: window.$app.resource.getUrl(), type: 'illust' });
    await flushPromises();
  };

  test.each([
    ['an illust', {}, ['_download 0.00%']],
    ['an ugoira', ugoira, ['_download_apng', '_download_gif', '_download_webm', '_download_mp4', '_download_mkv', '_download_mov', '_download_zip (D:0.00%)']]
  ])("a queued 0%% on %s doesn't follow it to the next page", async (_, resourceOptions, queuedLabels) => {
    respondTo(addsDownloads);
    const wrapper = await mountWithPage(resourceOptions);

    await clickAndFlush(actionButtons(wrapper).at(-1));
    expect(actionLabels(wrapper)).toEqual(queuedLabels);

    await showNextPage();

    expect(actionLabels(wrapper)).toEqual(['_download']);
  });

  test('a page change while the add is in flight leaves the next page alone', async () => {
    let respond;
    respondTo({ 'download:ensureDownloadManagerOpen': true });
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.action === 'download:addDownload') {
        respond = sendResponse;
        return true;
      }
    });
    const wrapper = await mountWithPage(ugoira);

    await clickAndFlush(actionButtons(wrapper)[1]);
    await showNextPage();
    respond({ result: true });
    await flushPromises();

    expect(actionLabels(wrapper)).toEqual(['_download']);
  });

  // #403: Pixiv is a SPA, so the next work can load while the download manager tab opens.
  const showWork = async id => {
    const resource = fakeResource();
    resource.unpack = () => ({ type: 'Illust', id });
    window.$app = { resource };
    window.$eventBus.$emit('pagechange', { url: resource.getUrl(), type: 'illust' });
    await flushPromises();
  };

  const holdResponse = action => {
    const held = {};
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.action === action) {
        held.respond = sendResponse;
        return true;
      }
    });
    return held;
  };

  test('sends the clicked work when the next one loads while the download manager opens', async () => {
    const opening = holdResponse('download:ensureDownloadManagerOpen');
    respondTo({ 'download:addDownload': { result: true } });
    const wrapper = mountLive();
    await showWork('A');

    await clickAndFlush(actionButtons(wrapper)[0]);
    await showWork('B');
    opening.respond(true);
    await flushPromises();

    expect(sentMessages('download:addDownload').map(message => message.args.unpackedResource.id)).toEqual(['A']);
    expect(actionLabels(wrapper)).toEqual(['_download']);
  });

  test('a re-download confirmed after the next work loads re-sends the clicked one', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    respondTo({ 'download:ensureDownloadManagerOpen': true });
    const adding = holdResponse('download:addDownload');
    const wrapper = mountLive();
    await showWork('A');

    await clickAndFlush(actionButtons(wrapper)[0]);
    await showWork('B');
    adding.respond({ result: false, errorName: 'DownloadTaskExistsError' });
    await flushPromises();
    adding.respond({ result: true });
    await flushPromises();

    expect(sentMessages('download:addDownload').map(({ args }) => [args.unpackedResource.id, args.options.redownload]))
      .toEqual([['A', false], ['A', true]]);
    expect(actionLabels(wrapper)).toEqual(['_download']);
  });

  test('declining the re-add prompt sends nothing more', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    respondTo(existsUntilRedownload);
    const wrapper = await mountWithPage();

    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(sentMessages('download:addDownload')).toHaveLength(1);
    expect(sentMessages('history:itemDownload')).toHaveLength(0);
  });

  test('alerts on any other add failure', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    respondTo({
      'download:ensureDownloadManagerOpen': true,
      'download:addDownload': { result: false, errorName: 'SomethingElse' }
    });
    const wrapper = await mountWithPage();

    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(alert).toHaveBeenCalledWith('_unknown_error: SomethingElse');
    expect(sentMessages('history:itemDownload')).toHaveLength(0);
  });

  test('tells the user when the download manager will not open', async () => {
    const wrapper = await mountWithPage();

    await clickAndFlush(actionButtons(wrapper)[0]);

    expect(sentMessages('download:addDownload')).toHaveLength(0);
    expect(wrapper.find('.ptk__download-added-notice').isVisible()).toBe(true);
    expect(wrapper.find('.ptk__download-added-notice').text())
      .toBe('_cant_open_download_manager');
  });
});
