/**
 * The wiring around the settings migrations: which of them `Updater` decides
 * to run for a given version pair, and what `Application.onInstalled` does
 * either side of that.
 *
 * The individual migrations are covered in their own specs; the fakes here
 * stand in for them so a failure points at the gate rather than at what a
 * migration wrote.
 */
const browser = require('./doubles/browser').default;
const Application = require('../src/background/Application').default;
const SettingService = require('../src/background/services/SettingService').default;
const Updater = require('../src/background/modules/Updater').default;
const updates = require('../src/background/updates').default;
const versionCompare = require('../src/modules/Util/versionCompare');

beforeEach(() => {
  Application.instance = undefined;
  SettingService.instance = undefined;

  Application.createApp();
});

/**
 * A map of stand-in migrations that record the order they ran in.
 */
function fakeUpdates(...versions) {
  const ran = [];
  const map = new Map();

  versions.forEach(version => {
    map.set(version, async () => {
      await browser._fake.flush();

      ran.push(version);
    });
  });

  return { map, ran };
}

describe('Updater', () => {
  test('runs the updates newer than the version installed', async () => {
    const { map, ran } = fakeUpdates('6.0.0', '6.4.3');

    await new Updater('6.4.3', '5.5.3', map).update();

    expect(ran).toEqual(['6.0.0', '6.4.3']);
  });

  test('skips the updates the installed version has already seen', async () => {
    const { map, ran } = fakeUpdates('6.0.0', '6.4.3');

    await new Updater('6.4.3', '6.2.0', map).update();

    expect(ran).toEqual(['6.4.3']);
  });

  test('runs nothing when the installed version is already current', async () => {
    const { map, ran } = fakeUpdates('6.0.0', '6.4.3');

    await new Updater('6.4.3', '6.4.3', map).update();

    expect(ran).toEqual([]);
  });

  test('waits for each update before starting the next', async () => {
    /**
     * The migrations share settings storage, so a later one has to see what
     * an earlier one wrote. `update()` used to dispatch them through
     * `forEach(async ...)`, which awaited nothing and resolved before any of
     * them had finished — the `flush()` inside each fake is what catches
     * that.
     */
    const { map, ran } = fakeUpdates('6.0.0', '6.4.3');

    await new Updater('6.4.3', '5.5.3', map).update();

    expect(ran).toEqual(['6.0.0', '6.4.3']);
  });
});

describe('the registered updates', () => {
  test('are keyed in ascending version order', () => {
    const versions = Array.from(updates().keys());

    expect(versions).toEqual([...versions].sort(versionCompare));
  });

  test('are all callable', () => {
    Array.from(updates().values()).forEach(update => {
      expect(typeof update).toBe('function');
    });
  });
});

describe('Application.onInstalled', () => {
  const install = ({ reason, manifestVersion, settings }) => {
    browser._fake.setManifest({ version: manifestVersion, manifest_version: 3 });

    return browser.storage.local.set(settings)
      .then(() => Application.app().onInstalled({ reason }));
  };

  test('seeds the defaults on a fresh install', async () => {
    await install({ reason: 'install', manifestVersion: '6.4.3', settings: {} });

    expect(browser.storage.local.items.illustRenameRule).toBe('{id}_{title}');
    expect(browser.action.badge.text).toBe('NEW');
  });

  test('stamps the installed version after updating', async () => {
    await install({ reason: 'install', manifestVersion: '6.4.3', settings: { version: '5.5.3' } });

    /**
     * `update6_0_0` writes '6.0.0'. Nothing else would move it on, so
     * without this stamp every later extension update would re-run anything
     * keyed above 6.0.0.
     */
    expect(browser.storage.local.items.version).toBe('6.4.3');
  });

  test('runs the migrations before stamping the version', async () => {
    await install({ reason: 'install', manifestVersion: '6.4.3', settings: {
      version: '5.5.3',
      illustrationRelativeLocation: 'illust',
      illustrationRenameFormat: '{id}_{title}',
      illustrationImageRenameFormat: 'p{pageNum}'
    } });

    expect(browser.storage.local.items.illustRenameRule).toBe('illust/{id}_{title}/p{pageNum}');
    expect(browser.storage.local.items.version).toBe('6.4.3');
  });

  test('does nothing when the installed version is not newer', async () => {
    await install({ reason: 'update', manifestVersion: '6.4.3', settings: {
      version: '6.4.3',
      illustRenameRule: 'mine/{id}'
    } });

    expect(browser.storage.local.items.illustRenameRule).toBe('mine/{id}');
    expect(browser.action.badge.text).toBe('');
  });

  test('ignores reasons other than install and update', async () => {
    await install({ reason: 'chrome_update', manifestVersion: '6.4.3', settings: { version: '5.5.3' } });

    expect(browser.storage.local.items.version).toBe('5.5.3');
  });
});
