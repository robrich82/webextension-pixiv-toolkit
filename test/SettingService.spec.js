/**
 * Drives the real background `SettingService` against the extension API fake,
 * which is what `jest.config.json` resolves `@/modules/Extension/browser` to.
 */
const browser = require('./doubles/browser').default;
const SettingService = require('../src/background/services/SettingService').default;

let service;
let application;

beforeEach(() => {
  /**
   * The service is a singleton and registers its `onChanged` listener in the
   * constructor, which `reset()` has just cleared. Build a fresh one each time.
   */
  SettingService.instance = undefined;

  service = SettingService.getService();
  application = { settings: {} };

  service.setApplication(application);
});

test('reads back the settings it wrote', async () => {
  await service.updateSettings({ language: 'ja', enableExtTakeOverDownloads: true });

  expect(await service.getSetting('language')).toEqual({ language: 'ja' });
});

test('reads every setting', async () => {
  await service.updateSettings({ language: 'ja', version: '6.4.2' });

  expect(await service.getSettings()).toEqual({ language: 'ja', version: '6.4.2' });
});

test('reads a list of keys, skipping the ones never written', async () => {
  await service.updateSettings({ language: 'ja' });

  expect(await service.getSetting(['language', 'version'])).toEqual({ language: 'ja' });
});

test('mirrors a storage change onto the application settings', async () => {
  await service.updateSettings({ language: 'ja' });

  expect(application.settings.language).toBe('ja');
});

test('mirrors a change made outside the service', async () => {
  await browser.storage.local.set({ language: 'zh_CN' });

  expect(application.settings.language).toBe('zh_CN');
});
