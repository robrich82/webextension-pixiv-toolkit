import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import OtherOptions from '@/options_page/components/options/OtherOptions.vue';
import defaultSettings from '@/config/default';

describe('OtherOptions', () => {
  test('reload() reloads the extension runtime', () => {
    const wrapper = shallowMountOption(OtherOptions);

    wrapper.vm.reload();

    expect(browser.runtime.reload).toHaveBeenCalled();
  });

  test('viewDiagnosis() routes to the diagnosis messages page', () => {
    const push = jest.fn().mockResolvedValue();
    const wrapper = shallowMountOption(OtherOptions, {
      mocks: { $router: { push } }
    });

    wrapper.vm.viewDiagnosis();

    expect(push).toHaveBeenCalledWith({ name: 'DiagnosisMessages' });
  });

  test('exportSettings() downloads every current setting by default', () => {
    URL.createObjectURL = jest.fn(() => 'blob:fake');
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const wrapper = shallowMountOption(OtherOptions, {
      browserItems: { language: 'en', historyBackup: [{ id: 1 }] }
    });

    wrapper.vm.exportSettings({});

    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
    delete URL.createObjectURL;
  });

  test('exportSettings() excludes historyBackup when asked', () => {
    URL.createObjectURL = jest.fn();
    const captured = [];
    jest.spyOn(global, 'Blob').mockImplementation(function (parts) {
      captured.push(JSON.parse(parts[0]));
    });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const wrapper = shallowMountOption(OtherOptions, {
      browserItems: { language: 'en', historyBackup: [{ id: 1 }] }
    });

    wrapper.vm.exportSettings({ excludeHistoryBackup: true });

    expect(captured[0]).toEqual({ language: 'en' });

    global.Blob.mockRestore();
    HTMLAnchorElement.prototype.click.mockRestore();
    delete URL.createObjectURL;
  });

  // jsdom logs a "Not implemented: navigation" console.error for the
  // window.location.reload() this exercises — expected noise, not a failure.
  test('importSettings() merges same-typed keys from the file into the shared defaults and persists them', async () => {
    const originalFileReader = global.FileReader;
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
          notInDefaults: 'ignored'
        });
        loadListener();
      }
    };

    let changeListener;
    jest.spyOn(HTMLInputElement.prototype, 'addEventListener').mockImplementation(function (event, listener) {
      if (event === 'change') {
        changeListener = listener;
      }
    });
    jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    window.alert = jest.fn();

    const wrapper = shallowMountOption(OtherOptions);

    wrapper.vm.importSettings({});

    expect(HTMLInputElement.prototype.click).toHaveBeenCalled();

    changeListener({ target: { files: ['fake-file'] } });
    await browser._fake.flush();

    expect(defaultSettings.language).toBe('ja');
    expect(defaultSettings.maxHistoryItems).toBe(5000);
    // `importSettings[key] &&` rejects any falsy import value, so a `false`
    // import is silently dropped even though its type matches — a pre-existing
    // quirk the source itself flags as "checking logic need be improved".
    expect(defaultSettings.enablePtkSearch).toBe(true);
    expect(defaultSettings.notInDefaults).toBeUndefined();
    expect(browser.storage.local.items.language).toBe('ja');
    expect(browser.storage.local.items.maxHistoryItems).toBe(5000);
    expect(window.alert).toHaveBeenCalledWith('Settings imported');

    HTMLInputElement.prototype.addEventListener.mockRestore();
    HTMLInputElement.prototype.click.mockRestore();
    global.FileReader = originalFileReader;
  });
});
