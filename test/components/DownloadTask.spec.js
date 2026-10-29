import { mountOption } from '../helpers/mountOptionComponent';
import DownloadTask from '@/options_page/components/DownloadTask.vue';

const task = overrides => ({ id: '1', title: 'Title', url: 'https://www.pixiv.net/artworks/1', progress: 0.5, state: 2, ...overrides });

describe('DownloadTask', () => {
  test('shows the title, link, tag and actions slot', () => {
    const wrapper = mountOption(DownloadTask, {
      props: { data: task(), tag: 'Pixiv Illust' },
      slots: { actions: '<span class="action">Delete</span>' }
    });

    expect(wrapper.find('.download-task__title').text()).toBe('Title');
    expect(wrapper.find('.download-task__url a').attributes('href')).toBe('https://www.pixiv.net/artworks/1');
    expect(wrapper.find('.download-task__type-tag').text()).toBe('Pixiv Illust');
    expect(wrapper.find('.download-task__actions .action').text()).toBe('Delete');
  });

  test.each([
    [1, 'Pending'],
    [2, 'Downloading'],
    [3, 'Paused'],
    [4, 'Complete'],
    [-1, 'Failure'],
    [99, 'Processing'],
    [7, 'Unkown']
  ])('state %s reads as %s', (state, label) => {
    const wrapper = mountOption(DownloadTask, { props: { data: task({ state }) } });

    expect(wrapper.find('.download-task__state').text()).toBe(label);
  });

  test('shows download progress until processing starts', async () => {
    const wrapper = mountOption(DownloadTask, { props: { data: task({ progress: 0.5 }) } });

    expect(wrapper.find('.download-task__progress').attributes('title')).toBe('50%');

    await wrapper.setProps({ data: task({ progress: 1, processProgress: 0.25 }) });

    expect(wrapper.find('.download-task__progress').attributes('title')).toBe('25%');
  });

  test('a well-formed task passes the data validator', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    mountOption(DownloadTask, { props: { data: task() } });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test.each([
    ['a non-string id', { id: 1 }],
    ['a missing title', { title: undefined }],
    ['a non-numeric progress', { progress: null }],
    ['a non-numeric processProgress', { processProgress: '0.5' }],
    ['a non-numeric state', { state: '2' }]
  ])('the data validator rejects %s', (_, overrides) => {
    const { validator } = DownloadTask.props.data;

    expect(validator(task(overrides))).toBe(false);
  });

  test('is Untagged without a tag', () => {
    expect(mountOption(DownloadTask, { props: { data: task() } }).find('.download-task__type-tag').text()).toBe('Untagged');
  });
});
