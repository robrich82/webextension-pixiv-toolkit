import browser from '../doubles/browser';
import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import OtherOptions from '@/options_page/components/options/OtherOptions.vue';
import defaultSettings from '@/config/default';

// `defaultSettings` is a shared module-level singleton that importSettings()
// mutates in place; snapshot it once so any test that changes it can be
// undone regardless of whether that test itself passes or fails.
const defaultSettingsSnapshot = { ...defaultSettings };
const originalFileReader = global.FileReader;

describe('OtherOptions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
    delete window.alert;
    global.FileReader = originalFileReader;
    Object.assign(defaultSettings, defaultSettingsSnapshot);
  });

  // shallowMount stubs `v-list-item` and only renders its default slot, so it
  // can't see this component's `#title`/`#append` named slots (see
  // DownloadSaveMode.spec.js for the same pattern).
  test('renders the title through the migrated named slots', () => {
    const wrapper = mountOption(OtherOptions);

    expect(wrapper.text()).toContain('_export_settings.message');
  });

  test('reload() reloads the extension runtime', () => {
    const wrapper = shallowMountOption(OtherOptions);

    wrapper.vm.reload();

    expect(browser.runtime.reload).toHaveBeenCalled();
  });

  test('viewDiagnosis() routes to the diagnosis messages page', () => {
    const push = vi.fn().mockResolvedValue();
    const wrapper = shallowMountOption(OtherOptions, {
      mocks: { $router: { push } }
    });

    wrapper.vm.viewDiagnosis();

    expect(push).toHaveBeenCalledWith({ name: 'DiagnosisMessages' });
  });

  test('exportSettings() downloads every current setting by default', () => {
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const wrapper = shallowMountOption(OtherOptions, {
      browserItems: { language: 'en' }
    });

    wrapper.vm.exportSettings();

    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickSpy).toHaveBeenCalled();
  });

  test('exportSettings() revokes the blob url after the click, not during it', () => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const wrapper = shallowMountOption(OtherOptions, { browserItems: { language: 'en' } });

    wrapper.vm.exportSettings();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  test('exportSettings() writes the current settings as they are', () => {
    URL.createObjectURL = vi.fn();
    URL.revokeObjectURL = vi.fn();
    const captured = [];
    vi.spyOn(global, 'Blob').mockImplementation(function (parts) {
      captured.push(JSON.parse(parts[0]));
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const wrapper = shallowMountOption(OtherOptions, {
      browserItems: { language: 'en', maxHistoryItems: 5000 }
    });

    wrapper.vm.exportSettings();

    expect(captured[0]).toEqual({ language: 'en', maxHistoryItems: 5000 });
  });

  // jsdom logs a "Not implemented: navigation" console.error for the
  // window.location.reload() this exercises — expected noise, not a failure.
  test('importSettings() merges same-typed keys, including falsy values, from the file into the shared defaults and persists them', async () => {
    let loadListener;

    global.FileReader = class {
      addEventListener(event, listener) {
        if (event === 'load') {
          loadListener = listener;
        }
      }

      readAsText() {
        this.result = JSON.stringify({
          language: 'ja',
          maxHistoryItems: 5000,
          enablePtkSearch: false,
          notInDefaults: 'ignored',
          // a settings file exported before 6.4.7
          historyBackup: [{ id: 1 }]
        });
        loadListener();
      }
    };

    let changeListener;
    vi.spyOn(HTMLInputElement.prototype, 'addEventListener').mockImplementation(function (event, listener) {
      if (event === 'change') {
        changeListener = listener;
      }
    });
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    window.alert = vi.fn();

    const wrapper = shallowMountOption(OtherOptions);

    wrapper.vm.importSettings();

    expect(HTMLInputElement.prototype.click).toHaveBeenCalled();

    changeListener({ target: { files: ['fake-file'] } });
    await browser._fake.flush();

    expect(defaultSettings.language).toBe('ja');
    expect(defaultSettings.maxHistoryItems).toBe(5000);
    expect(defaultSettings.enablePtkSearch).toBe(false);
    expect(defaultSettings.notInDefaults).toBeUndefined();
    expect('historyBackup' in browser.storage.local.items).toBe(false);
    expect(browser.storage.local.items.language).toBe('ja');
    expect(browser.storage.local.items.maxHistoryItems).toBe(5000);
    expect(window.alert).toHaveBeenCalledWith('Settings imported');
  });
});
