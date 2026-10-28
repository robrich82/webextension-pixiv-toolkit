import { shallowMountOption } from '../helpers/mountOptionComponent';
import DownloadManager from '@/options_page/components/DownloadManager.vue';

const mockDownloadService = {
  changed: [],
  flushChangedTasks: jest.fn(() => mockDownloadService.changed.splice(0)),
  deleteDownload: jest.fn(),
  showInFolder: jest.fn()
};

jest.mock('@/options_page/DownloadsApplication', () => ({
  app: () => ({ getService: () => mockDownloadService })
}));

// The real RecycleScroller is ESM-only and sizes rows from a viewport jsdom
// doesn't have; this stand-in renders every item through the slot.
jest.mock('vue-virtual-scroller', () => ({
  RecycleScroller: {
    props: ['items'],
    template: '<div><template v-for="item in items" :key="item.id"><slot :item="item" /></template></div>'
  }
}));

const task = (id, overrides) => ({ id, title: `Task ${id}`, url: 'u', progress: 0, state: 1, type: 'PIXIV_ILLUST', ...overrides });

describe('DownloadManager', () => {
  let wrapper;

  beforeEach(() => {
    jest.useFakeTimers();
    mockDownloadService.changed = [];
    wrapper = shallowMountOption(DownloadManager, {
      global: { stubs: { 'recycle-scroller': false, DownloadTask: false } }
    });
  });

  afterEach(() => {
    wrapper.unmount();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  const poll = async (...tasks) => {
    mockDownloadService.changed.push(...tasks);
    jest.advanceTimersByTime(600);
    await wrapper.vm.$nextTick();
  };

  const titles = () => wrapper.findAll('.download-task__title').map(t => t.text());

  test('shows the empty notice until tasks arrive', async () => {
    expect(wrapper.find('.dataset-empty-notice').exists()).toBe(true);

    await poll(task(1));

    expect(wrapper.find('.dataset-empty-notice').exists()).toBe(false);
    expect(titles()).toEqual(['Task 1']);
  });

  test('polls every 600ms, updating known tasks in place and appending new ones', async () => {
    await poll(task(1), task(2));
    await poll(task(2, { title: 'Task 2 renamed' }), task(3));

    expect(titles()).toEqual(['Task 1', 'Task 2 renamed', 'Task 3']);
  });

  test.each([
    [{ type: 'PIXIV_UGOIRA', convertType: 'gif' }, 'Pixiv Ugoira gif'],
    [{ type: 'PIXIV_UGOIRA' }, 'Pixiv Ugoira Custom'],
    [{ type: 'PIXIV_ILLUST' }, 'Pixiv Illust'],
    [{ type: 'PIXIV_MANGA' }, 'Pixiv Manga'],
    [{ type: 'PIXIV_NOVEL' }, 'Pixiv Novel'],
    [{ type: 'PIXIV_COMIC_EPISODE' }, 'Pixiv Comic Episode'],
    [{ type: 'FANBOX_POST' }, 'Fanbox Post']
  ])('tags %o as %s', (download, tag) => {
    expect(wrapper.vm.getDownloadTaskTag(download)).toBe(tag);
  });

  test('rejects an unknown download type', () => {
    expect(() => wrapper.vm.getDownloadTaskTag({ type: 'NOPE' })).toThrow('Invalid download type');
  });

  test('delete asks first, then removes the task from the service and the list', async () => {
    await poll(task(1), task(2));

    await wrapper.findAll('.download-task__action--delete')[0].trigger('click');
    expect(wrapper.vm.confirmDialog).toBe(true);
    expect(mockDownloadService.deleteDownload).not.toHaveBeenCalled();

    wrapper.vm.deleteDownloadTask(wrapper.vm.preparedDeleteItem);
    await wrapper.vm.$nextTick();

    expect(mockDownloadService.deleteDownload).toHaveBeenCalledWith(1);
    expect(wrapper.vm.confirmDialog).toBe(false);
    expect(titles()).toEqual(['Task 2']);
  });

  test('show in folder is offered only once the browser download exists', async () => {
    await poll(task(1), task(2, { downloadId: 42 }));

    const actions = wrapper.findAll('.download-task__actions');
    expect(actions[0].text()).not.toContain('_show_in_folder');

    await actions[1].find('.download-task__action').trigger('click');

    expect(mockDownloadService.showInFolder).toHaveBeenCalledWith(42);
  });

  test('warns before the tab closes', () => {
    const event = {};

    expect(window.onbeforeunload(event)).toBe(event.returnValue);
    expect(event.returnValue).toMatch(/lose all download process/);
  });
});
