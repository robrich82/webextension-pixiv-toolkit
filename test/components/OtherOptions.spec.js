import browser from '../doubles/browser';
import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import OtherOptions from '@/options_page/components/options/OtherOptions.vue';
import defaultSettings from '@/config/default';

// `defaultSettings` is a shared module-level singleton; snapshot it so a test
// can check that importSettings() leaves it alone, and so afterEach can undo
// a change if it doesn't.
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

  describe('importSettings()', () => {
    // Opens the file picker and feeds `contents` through the change and load
    // listeners. jsdom logs a "Not implemented: navigation" console.error for
    // the window.location.reload() this ends in; expected noise, not a failure.
    async function importFile(contents) {
      let loadListener;

      global.FileReader = class {
        addEventListener(event, listener) {
          if (event === 'load') {
            loadListener = listener;
          }
        }

        readAsText() {
          this.result = contents;
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

      shallowMountOption(OtherOptions).vm.importSettings();

      expect(HTMLInputElement.prototype.click).toHaveBeenCalled();

      changeListener({ target: { files: ['fake-file'] } });
      await browser._fake.flush();
    }

    test('writes same-typed keys, including falsy values, and drops keys the defaults lack', async () => {
      await importFile(JSON.stringify({
        language: 'ja',
        maxHistoryItems: 5000,
        enablePtkSearch: false,
        notInDefaults: 'ignored',
        // a settings file exported before 6.4.7
        historyBackup: [{ id: 1 }]
      }));

      expect(browser.storage.local.items).toEqual({
        language: 'ja',
        maxHistoryItems: 5000,
        enablePtkSearch: false
      });
      expect(window.alert).toHaveBeenCalledWith('Settings imported');
    });

    test("keeps the stored version, so the next update doesn't rerun migrations", async () => {
      browser.storage.local.items = { version: '6.4.7' };

      await importFile(JSON.stringify({ version: '6.0.0', language: 'ja' }));

      expect(browser.storage.local.items).toEqual({ version: '6.4.7', language: 'ja' });
    });

    test('keeps the current value of settings the backup lacks', async () => {
      browser.storage.local.items = { maxHistoryItems: 3000, language: 'en' };

      await importFile(JSON.stringify({ language: 'ja' }));

      expect(browser.storage.local.items).toEqual({ maxHistoryItems: 3000, language: 'ja' });
    });

    test("doesn't change the shared defaults", async () => {
      await importFile(JSON.stringify({ language: 'ja', maxHistoryItems: 5000 }));

      expect(defaultSettings).toEqual(defaultSettingsSnapshot);
    });

    test('rejects a value of another type, but reads a numeric string for a number setting as that number', async () => {
      browser.storage.local.items = { enablePtkSearch: true, multipleDownloadsGapTime: 150 };

      await importFile(JSON.stringify({
        enablePtkSearch: 'false',
        maxHistoryItems: '5000',
        multipleDownloadsGapTime: 'fast',
        maxProcessDownloadTasks: ' ',
        language: 7
      }));

      expect(browser.storage.local.items).toEqual({
        enablePtkSearch: true,
        maxHistoryItems: 5000,
        multipleDownloadsGapTime: 150
      });
    });

    test("doesn't write or announce an import when the file isn't a settings object", async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      browser.storage.local.items = { language: 'en' };

      await importFile('not json');
      await importFile('null');

      expect(browser.storage.local.items).toEqual({ language: 'en' });
      expect(window.alert).not.toHaveBeenCalled();
    });
  });
});
