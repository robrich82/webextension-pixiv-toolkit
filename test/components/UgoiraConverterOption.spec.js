import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import UgoiraConverterOption from '@/options_page/components/options/UgoiraConverterOption.vue';

/**
 * The template's `<v-select @change="onUgoiraConvertToolChangeHandler">` has
 * no matching method anywhere in the component (grep confirms it) — a
 * pre-existing dead reference. That alone is harmless, but the moment this
 * component actually re-renders with the handler still undefined, Vue's
 * listener-patch throws ("Cannot read properties of undefined (reading
 * '_wrapper')"), and because that throw happens inside the *render* watcher
 * (not a user watcher), it escapes flushSchedulerQueue before the queue is
 * reset — which permanently wedges Vue's scheduler for every component
 * sharing this localVue afterwards (later watchers get queued but never
 * flushed again). Stubbing the method sidesteps that landmine so it can't
 * take out unrelated tests later in the same file.
 */
function mountConverter(options) {
  return shallowMountOption(UgoiraConverterOption, {
    methods: { onUgoiraConvertToolChangeHandler: () => {} },
    ...options
  });
}

describe('UgoiraConverterOption', () => {
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
