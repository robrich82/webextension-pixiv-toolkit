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

  test('a failed task shows its reason after the state, in full on hover', () => {
    const wrapper = mountOption(DownloadTask, { props: { data: task({ state: -1, error: 'HTTP 404' }) } });
    const state = wrapper.find('.download-task__state');

    expect(state.text()).toBe('Failure: HTTP 404');
    expect(state.find('.download-task__error').exists()).toBe(true);
    expect(state.attributes('title')).toBe('HTTP 404');
  });

  test.each([
    ['a failed task with no reason', { state: -1, error: null }],
    ['a task that is not failed, even with an error from a file it will retry', { state: 2, error: 'HTTP 500' }]
  ])('%s shows only its state', (_, overrides) => {
    const wrapper = mountOption(DownloadTask, { props: { data: task(overrides) } });
    const state = wrapper.find('.download-task__state');

    expect(state.find('.download-task__error').exists()).toBe(false);
    expect(state.attributes('title')).toBeUndefined();
  });

  test('shows download progress until processing starts', async () => {
    const wrapper = mountOption(DownloadTask, { props: { data: task({ progress: 0.5 }) } });

    expect(wrapper.find('.download-task__progress').attributes('title')).toBe('50%');

    await wrapper.setProps({ data: task({ progress: 1, processProgress: 0.25 }) });

    expect(wrapper.find('.download-task__progress').attributes('title')).toBe('25%');
  });

  test('a well-formed task passes the data validator', () => {
    expect(DownloadTask.props.data.validator(task())).toBe(true);
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
