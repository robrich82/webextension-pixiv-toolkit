import { flushPromises } from '@vue/test-utils';
import moment from 'moment';
import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import History from '@/options_page/components/History.vue';

const mockRepo = {
  getItems: jest.fn(),
  searchItems: jest.fn()
};

jest.mock('@/modules/Db/Db', () => ({
  __esModule: true,
  default: { getDb: () => ({ historyRepo: () => mockRepo }) }
}));

const item = (id, overrides) => ({
  id, uid: `illust:${id}`, title: `Work ${id}`, url: `https://www.pixiv.net/artworks/${id}`,
  cover: `${id}.jpg`, type: 'pixiv_illust', r: false, visited_at: 1700000000, ...overrides
});

// Serves `pages` one call at a time, then empty pages.
const servePages = (fn, ...pages) => fn.mockImplementation(async () => pages.shift() || []);

// Unmounted after each test: a live History keeps a window scroll listener
// that would otherwise page the shared mockRepo in later tests.
let mounted = [];

const mountHistory = (browserItems = {}, locale = 'en') => {
  const wrapper = shallowMountOption(History, {
    browserItems: { enableSaveVisitHistory: true, ...browserItems },
    mocks: { $i18n: { locale } },
    global: { stubs: { 'recycle-scroller': false, 'cacheable-image': false } }
  });

  mounted.push(wrapper);

  return wrapper;
};

const titles = wrapper => wrapper.findAll('.history-item__info-entity--blod').map(e => e.text());
const dialogButton = (wrapper, label) => wrapper.find('v-dialog-stub').findAll('v-btn-stub').find(b => b.text() === label);
const scroll = () => window.dispatchEvent(new Event('scroll'));

describe('History', () => {
  afterEach(() => {
    mounted.forEach(wrapper => wrapper.unmount());
    mounted = [];
    jest.useRealTimers();
    jest.restoreAllMocks();
    mockRepo.getItems.mockReset();
    mockRepo.searchItems.mockReset();
  });

  test('loads the first page on creation', async () => {
    servePages(mockRepo.getItems, [item(1), item(2)]);

    const wrapper = mountHistory();
    await flushPromises();

    expect(mockRepo.getItems).toHaveBeenCalledWith({ page: 1 });
    expect(titles(wrapper)).toEqual(['Work 1', 'Work 2']);
    expect(wrapper.find('.history__status-notice').exists()).toBe(false);
  });

  test('says so when there is no history, and warns when saving is off', async () => {
    servePages(mockRepo.getItems);

    const wrapper = mountHistory({ enableSaveVisitHistory: false });
    await flushPromises();

    expect(wrapper.find('.history__status-notice').text()).toBe('_there_is_no_any_history.message');
    expect(wrapper.text()).toContain('_save_visit_history_has_been_disabled.message');
  });

  test('scrolling near the bottom loads the next page until one comes back empty', async () => {
    servePages(mockRepo.getItems, [item(1)], [item(2)]);

    const wrapper = mountHistory();
    await flushPromises();

    for (let i = 0; i < 3; i++) {
      scroll();
      await flushPromises();
    }

    expect(mockRepo.getItems.mock.calls.map(([args]) => args.page)).toEqual([1, 2, 3]);
    expect(titles(wrapper)).toEqual(['Work 1', 'Work 2']);
    expect(wrapper.vm.allLoaded).toBe(true);
  });

  test('stops listening for scroll once unmounted', async () => {
    servePages(mockRepo.getItems, [item(1)]);

    const wrapper = mountHistory();
    await flushPromises();
    wrapper.unmount();
    mounted = [];

    scroll();
    await flushPromises();

    expect(mockRepo.getItems).toHaveBeenCalledTimes(1);
  });

  test('scrolling far from the bottom loads nothing', async () => {
    servePages(mockRepo.getItems, [item(1)], [item(2)]);
    jest.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(10000);

    mountHistory();
    await flushPromises();
    scroll();
    await flushPromises();

    expect(mockRepo.getItems).toHaveBeenCalledTimes(1);
  });

  test('a scroll while a page is still loading does not fetch it twice', async () => {
    servePages(mockRepo.getItems, [item(1)], [item(2)]);

    const wrapper = mountHistory();
    await flushPromises();
    scroll();
    scroll();
    await flushPromises();

    expect(mockRepo.getItems.mock.calls.map(([args]) => args.page)).toEqual([1, 2]);
    expect(titles(wrapper)).toEqual(['Work 1', 'Work 2']);
  });

  test('scrolling during a search pages the search, not the full history', async () => {
    jest.useFakeTimers();
    servePages(mockRepo.getItems, [item(1)]);
    servePages(mockRepo.searchItems, [item(2)], [item(3)]);

    const wrapper = mountHistory();
    await flushPromises();
    await wrapper.setData({ searchQuery: 'Work' });
    jest.advanceTimersByTime(600);
    await flushPromises();

    scroll();
    await flushPromises();

    expect(mockRepo.searchItems.mock.calls).toEqual([[{ page: 1, query: 'Work' }], [{ page: 2, query: 'Work' }]]);
    expect(mockRepo.getItems).toHaveBeenCalledTimes(1);
    expect(titles(wrapper)).toEqual(['Work 2', 'Work 3']);
  });

  test('a search query reloads from page 1 after a 600ms pause; clearing it lists everything again', async () => {
    jest.useFakeTimers();
    servePages(mockRepo.getItems, [item(1)], [item(1), item(2)]);
    servePages(mockRepo.searchItems, [item(2)]);

    const wrapper = mountHistory();
    await flushPromises();

    await wrapper.setData({ searchQuery: 'Wo' });
    await wrapper.setData({ searchQuery: 'Work 2' });
    jest.advanceTimersByTime(599);
    expect(mockRepo.searchItems).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await flushPromises();

    expect(mockRepo.searchItems.mock.calls).toEqual([[{ page: 1, query: 'Work 2' }]]);
    expect(titles(wrapper)).toEqual(['Work 2']);

    await wrapper.setData({ searchQuery: '  ' });
    jest.advanceTimersByTime(600);
    await flushPromises();

    expect(mockRepo.getItems).toHaveBeenLastCalledWith({ page: 1 });
    expect(titles(wrapper)).toEqual(['Work 1', 'Work 2']);
  });

  test('deleting asks first, then drops the item and tells the background', async () => {
    servePages(mockRepo.getItems, [item(1), item(2), item(3)]);

    const wrapper = mountHistory();
    await flushPromises();

    await wrapper.findAll('.history-item__actions-btn')[1].trigger('click');
    expect(wrapper.vm.confirmDialog).toBe(true);

    await dialogButton(wrapper, '_delete.message').trigger('click');
    await flushPromises();

    expect(titles(wrapper)).toEqual(['Work 1', 'Work 3']);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      to: 'ws', action: 'history:deleteItem', args: { uid: 'illust:2' }
    });
  });

  test('keeping the item closes the prompt without deleting', async () => {
    servePages(mockRepo.getItems, [item(1)]);

    const wrapper = mountHistory();
    await flushPromises();

    await wrapper.find('.history-item__actions-btn').trigger('click');
    await dialogButton(wrapper, '_keep.message').trigger('click');

    expect(wrapper.vm.confirmDialog).toBe(false);
    expect(titles(wrapper)).toEqual(['Work 1']);
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('R-18 covers are blurred until the eye toggle is clicked', async () => {
    servePages(mockRepo.getItems, [item(1, { r: true }), item(2)]);

    const wrapper = mountHistory();
    await flushPromises();
    const blurred = () => wrapper.findAll('.history-item__thumb-body--blur').length;

    expect(blurred()).toBe(1);

    await wrapper.find('.history__header-action v-btn-stub').trigger('click');

    expect(blurred()).toBe(0);
  });

  test('clicking a cover opens the work in a new tab', async () => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    servePages(mockRepo.getItems, [item(1)]);

    const wrapper = mountHistory();
    await flushPromises();
    await wrapper.find('.history-item__thumb').trigger('click');

    expect(open).toHaveBeenCalledWith('https://www.pixiv.net/artworks/1', '_blank');
  });

  test.each([
    [1, { width: 100, height: 80 }],
    [2, { width: 137, height: 110 }],
    [3, { width: 187, height: 150 }],
    [undefined, { width: 187, height: 150 }]
  ])('cover size setting %s gives a %o thumbnail', async (workCoverSize, size) => {
    servePages(mockRepo.getItems, [item(1)]);

    const wrapper = mountHistory({ workCoverSize });
    await flushPromises();

    expect(wrapper.find('.history-item__thumb').element.style).toMatchObject({
      width: `${size.width}px`, height: `${size.height}px`
    });
  });

  test('labels each work type and downloaded items when asked to', async () => {
    servePages(mockRepo.getItems, [item(1, { downloaded_at: 1 }), item(2, { type: 'mystery' })]);

    const wrapper = mountHistory({ displayWorkTypeLabel: true });
    await flushPromises();

    expect(wrapper.findAll('.history-item__info-tag').map(t => t.text()))
      .toEqual(['Pixiv Illust', '_downloaded.message', 'uncatelogued']);
  });

  test.each([
    ['en', 'h:mmA'],
    ['zh_CN', 'A h:mm']
  ])('visit times use the %s time format', async (locale, format) => {
    servePages(mockRepo.getItems, [item(1)]);

    const wrapper = mountHistory({}, locale);
    await flushPromises();

    expect(wrapper.findAll('.history-item__info-entity--sub')[1].text())
      .toBe(moment.unix(1700000000).format(format));
  });
});
