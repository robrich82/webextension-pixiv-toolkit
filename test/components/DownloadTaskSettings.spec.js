import { shallowMountOption } from '../helpers/mountOptionComponent';
import DownloadTaskSettings from '@/options_page/components/options/DownloadTaskSettings.vue';

// Pure composition: no data/computed/watch/methods of its own, so this only
// has to prove it wires up every section without throwing.
describe('DownloadTaskSettings', () => {
  test('renders every download-task section', () => {
    const wrapper = shallowMountOption(DownloadTaskSettings);

    [
      'global-task-settings-stub',
      'ugoria-options-stub',
      'illust-options-stub',
      'manga-options-stub',
      'novel-options-stub',
      'pixiv-comic-options-stub',
      'fanbox-post-settings-stub'
    ].forEach(stub => {
      expect(wrapper.find(stub).exists()).toBe(true);
    });
  });
});
