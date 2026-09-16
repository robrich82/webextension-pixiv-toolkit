import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import UgoiraConverterOption from '@/options_page/components/options/UgoiraConverterOption.vue';

function mountConverter(options) {
  return shallowMountOption(UgoiraConverterOption, options);
}

describe('UgoiraConverterOption', () => {
  afterEach(() => {
    delete window.confirm;
  });

  test('adopts the stored tool, defaulting to "default" when nothing is stored', () => {
    const withStored = mountConverter({ browserItems: { ugoiraConvertTool: 'ffmpeg' } });
    expect(withStored.vm.ugoiraConvertTool).toBe('ffmpeg');

    const withoutStored = mountConverter({ browserItems: { ugoiraConvertTool: '' } });
    expect(withoutStored.vm.ugoiraConvertTool).toBe('default');
  });

  test('exposes the default/ffmpeg converter choices', () => {
    const wrapper = mountConverter({ browserItems: { ugoiraConvertTool: 'default' } });

    expect(wrapper.vm.converters).toEqual([
      { text: '_default.message', value: 'default' },
      { text: '_ffmpeg.message', value: 'ffmpeg' }
    ]);
  });

  test('switching to a non-ffmpeg tool persists immediately, no permission check', async () => {
    const wrapper = mountConverter({ browserItems: { ugoiraConvertTool: 'default' } });
    await browser._fake.flush();

    wrapper.vm.ugoiraConvertTool = 'ffmpeg2';
    await browser._fake.flush();

    expect(browser.permissions.contains).not.toHaveBeenCalled();
    expect(browser.storage.local.items.ugoiraConvertTool).toBe('ffmpeg2');
  });

  test('switching to ffmpeg with the permission already granted persists without prompting', async () => {
    browser._fake.state.grantedPermissions = { permissions: [], origins: ['https://unpkg.com/*'] };
    const wrapper = mountConverter({ browserItems: { ugoiraConvertTool: 'default' } });
    await browser._fake.flush();
    window.confirm = jest.fn();

    wrapper.vm.ugoiraConvertTool = 'ffmpeg';
    await browser._fake.flush();

    expect(window.confirm).not.toHaveBeenCalled();
    expect(browser.storage.local.items.ugoiraConvertTool).toBe('ffmpeg');
  });

  test('switching to ffmpeg without the permission asks, then persists once granted', async () => {
    const wrapper = mountConverter({ browserItems: { ugoiraConvertTool: 'default' } });
    await browser._fake.flush();
    window.confirm = jest.fn(() => true);

    wrapper.vm.ugoiraConvertTool = 'ffmpeg';
    await browser._fake.flush();

    expect(window.confirm).toHaveBeenCalled();
    expect(browser.permissions.request).toHaveBeenCalledWith(
      { origins: ['https://unpkg.com/*'] },
      expect.any(Function)
    );
    expect(browser.storage.local.items.ugoiraConvertTool).toBe('ffmpeg');
  });

  test('reverts to the previous tool when the permission request is denied', async () => {
    const wrapper = mountConverter({ browserItems: { ugoiraConvertTool: 'default' } });
    await browser._fake.flush();
    window.confirm = jest.fn(() => true);
    browser.permissions.request.mockImplementationOnce((options, callback) => {
      callback(false);
      return Promise.resolve(false);
    });

    wrapper.vm.ugoiraConvertTool = 'ffmpeg';
    await browser._fake.flush();
    await browser._fake.flush();

    expect(wrapper.vm.ugoiraConvertTool).toBe('default');
    // Reverting *to* 'default' is itself a watched change, so the else
    // branch fires too and persists it — the revert isn't silent.
    expect(browser.storage.local.items.ugoiraConvertTool).toBe('default');
  });

  // Declining the confirm() prompt skips the permission request entirely, but
  // nothing reverts the dropdown's v-model either: it's left showing "ffmpeg"
  // even though nothing was persisted or granted.
  test('declining the confirmation leaves the tool selected on screen without persisting it', async () => {
    const wrapper = mountConverter({ browserItems: { ugoiraConvertTool: 'default' } });
    await browser._fake.flush();
    window.confirm = jest.fn(() => false);

    wrapper.vm.ugoiraConvertTool = 'ffmpeg';
    await browser._fake.flush();

    expect(browser.permissions.request).not.toHaveBeenCalled();
    expect(wrapper.vm.ugoiraConvertTool).toBe('ffmpeg');
    expect(browser.storage.local.items.ugoiraConvertTool).toBeUndefined();
  });
});
