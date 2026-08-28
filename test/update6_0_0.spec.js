/**
 * Drives the 6.0.0 settings migration against the extension API fake.
 *
 * Despite living next to the history code, this migration does not touch
 * download history — it rewrites *settings*, folding the v5 "relative
 * location + rename format" triples into the single rename-rule strings 6.x
 * reads. It runs once per user, in the field, with no way to retry, and a
 * user's custom rename rules are not something they can get back if it
 * mangles them, which is what makes it worth pinning down.
 *
 * The v5 shapes seeded below are the deprecated keys still carried in
 * `src/config/default.js` under `@deprecated since version 6.0.0`.
 */
const browser = require('./doubles/browser').default;
const Application = require('../src/background/Application').default;
const SettingService = require('../src/background/services/SettingService').default;
const defaultSettings = require('../src/config/default').default;
const update6_0_0 = require('../src/background/updates/update6_0_0').default;

/**
 * A v5 install with every rename option customised, so a dropped or renamed
 * key shows up as a changed rule rather than being masked by a default.
 */
const v5Settings = () => ({
  version: '5.5.3',
  ugoiraRenameFormat: 'ugoira/{id}_{title}',
  mangaRelativeLocation: 'manga',
  mangaRenameFormat: '{userName}/{id}_{title}',
  mangaImageRenameFormat: 'p{pageNum}',
  illustrationRelativeLocation: 'illust',
  illustrationRenameFormat: '{userName}/{id}_{title}',
  illustrationImageRenameFormat: 'p{pageNum}',
  novelRelativeLocation: 'novel',
  novelRenameFormat: '{id}_{title}',
  pixivComicRelativeLocation: 'comic',
  pixivComicImageRenameFormat: '{id}_{title}_p{pageNum}',
  illustrationPageNumberStartWithOne: true,
  mangaPageNumberStartWithOne: true,
  pixivComicPageNumberStartWithOne: true
});

/**
 * Seed storage, run the migration, hand back what it left behind.
 */
async function migrate(settings) {
  await browser.storage.local.set(settings);

  await update6_0_0();

  return browser.storage.local.get(null);
}

beforeEach(() => {
  /**
   * Both are singletons that outlive `reset()`, and `SettingService`
   * registers its `onChanged` listener in the constructor, which `reset()`
   * has just cleared. Rebuild both each time.
   */
  Application.instance = undefined;
  SettingService.instance = undefined;

  Application.createApp();
});

describe('a realistic v5 install', () => {
  test('joins each location/format pair into one rename rule', async () => {
    const migrated = await migrate(v5Settings());

    expect(migrated.illustRenameRule).toBe('illust/{userName}/{id}_{title}/p{pageNum}');
    expect(migrated.mangaRenameRule).toBe('manga/{userName}/{id}_{title}/p{pageNum}');
    expect(migrated.novelRenameRule).toBe('novel/{id}_{title}');
    expect(migrated.pixivComicEpisodeRenameRule).toBe('comic/{id}_{title}_p{pageNum}');
  });

  test('carries the ugoira format over as-is, since it has no location part', async () => {
    const migrated = await migrate(v5Settings());

    expect(migrated.ugoiraRenameRule).toBe('ugoira/{id}_{title}');
  });

  test('keeps the per-type page numbering the user had turned on', async () => {
    const migrated = await migrate(v5Settings());

    expect(migrated.illustrationPageNumberStartWithOne).toBe(1);
    expect(migrated.mangaPageNumberStartWithOne).toBe(1);
    expect(migrated.pixivComicPageNumberStartWithOne).toBe(1);
  });

  test('leaves the settings 6.x added but v5 never had at their defaults', async () => {
    const migrated = await migrate(v5Settings());

    expect(migrated.fanboxPostRenameRule).toBe(defaultSettings.fanboxPostRenameRule);
    expect(migrated.downloadSaveMode).toBe(defaultSettings.downloadSaveMode);
  });

  test('stamps the version it migrated to', async () => {
    const migrated = await migrate(v5Settings());

    expect(migrated.version).toBe('6.0.0');
  });

  test('preserves settings it does not migrate', async () => {
    const migrated = await migrate(Object.assign(v5Settings(), {
      language: 'ja',
      enableExtTakeOverDownloads: true
    }));

    expect(migrated.language).toBe('ja');
    expect(migrated.enableExtTakeOverDownloads).toBe(true);
  });
});

describe('page numbering', () => {
  test('is off when the v5 setting was off', async () => {
    const migrated = await migrate(Object.assign(v5Settings(), {
      illustrationPageNumberStartWithOne: false,
      mangaPageNumberStartWithOne: false,
      pixivComicPageNumberStartWithOne: false
    }));

    expect(migrated.illustrationPageNumberStartWithOne).toBe(0);
    expect(migrated.mangaPageNumberStartWithOne).toBe(0);
    expect(migrated.pixivComicPageNumberStartWithOne).toBe(0);
  });

  test('reads the v5 manga key, which is lower-case', async () => {
    /**
     * Regression guard. The migration shipped reading
     * `MangaPageNumberStartWithOne`, a key that has never existed in any
     * version of the settings, so manga page numbering was silently switched
     * off for every user who had it on.
     */
    const migrated = await migrate(Object.assign(v5Settings(), {
      mangaPageNumberStartWithOne: true
    }));

    expect(migrated.mangaPageNumberStartWithOne).toBe(1);
  });
});

describe('the zip/save-mode pairing', () => {
  test('turns zipping back on and switches to save-in-folder', async () => {
    const migrated = await migrate(Object.assign(v5Settings(), {
      globalZipMultipleImages: 0
    }));

    expect(migrated.globalZipMultipleImages).toBe(1);
    expect(migrated.downloadSaveMode).toBe(1);
  });

  test('leaves save mode alone when zipping was already on', async () => {
    const migrated = await migrate(Object.assign(v5Settings(), {
      globalZipMultipleImages: 1,
      downloadSaveMode: 0
    }));

    expect(migrated.downloadSaveMode).toBe(0);
  });
});

describe('a fresh install', () => {
  test('falls back to the default rules rather than writing empty ones', async () => {
    const migrated = await migrate({});

    expect(migrated.illustRenameRule).toBe(defaultSettings.illustRenameRule);
    expect(migrated.mangaRenameRule).toBe(defaultSettings.mangaRenameRule);
    expect(migrated.novelRenameRule).toBe(defaultSettings.novelRenameRule);
    expect(migrated.ugoiraRenameRule).toBe(defaultSettings.ugoiraRenameRule);
    expect(migrated.pixivComicEpisodeRenameRule).toBe(defaultSettings.pixivComicEpisodeRenameRule);
  });
});

describe('a partial or malformed v5 install', () => {
  test('drops the missing half of a location/format pair instead of failing', async () => {
    const migrated = await migrate({
      version: '5.5.3',
      illustrationRelativeLocation: 'illust',
      illustrationRenameFormat: '{id}_{title}'
      /** No `illustrationImageRenameFormat`. */
    });

    expect(migrated.illustRenameRule).toBe('illust/{id}_{title}');
  });

  test('falls back to the default when every part of a rule is missing', async () => {
    const migrated = await migrate({
      version: '5.5.3',
      illustrationRelativeLocation: '',
      illustrationRenameFormat: '',
      illustrationImageRenameFormat: ''
    });

    expect(migrated.illustRenameRule).toBe(defaultSettings.illustRenameRule);
  });

  test('survives a value of the wrong type', async () => {
    const migrated = await migrate(Object.assign(v5Settings(), {
      novelRenameFormat: 42,
      mangaRelativeLocation: null
    }));

    expect(migrated.novelRenameRule).toBe('novel/42');
    expect(migrated.mangaRenameRule).toBe('{userName}/{id}_{title}/p{pageNum}');
  });
});

describe('running twice', () => {
  test('is a no-op the second time', async () => {
    const once = await migrate(v5Settings());

    await update6_0_0();

    expect(await browser.storage.local.get(null)).toEqual(once);
  });

  test('does not re-derive rules from the v5 keys once they are gone', async () => {
    /**
     * A 6.x install that never had the v5 keys — the shape left behind after
     * a user edits their rules in the options page. The migration must not
     * overwrite those edits with defaults.
     */
    const migrated = await migrate({
      version: '6.0.0',
      illustRenameRule: 'mine/{id}',
      mangaRenameRule: 'mine/{id}/p{pageNum}',
      novelRenameRule: 'mine/{id}',
      ugoiraRenameRule: 'mine/{id}',
      pixivComicEpisodeRenameRule: 'mine/{id}'
    });

    expect(migrated.illustRenameRule).toBe('mine/{id}');
    expect(migrated.mangaRenameRule).toBe('mine/{id}/p{pageNum}');
    expect(migrated.novelRenameRule).toBe('mine/{id}');
    expect(migrated.ugoiraRenameRule).toBe('mine/{id}');
    expect(migrated.pixivComicEpisodeRenameRule).toBe('mine/{id}');
  });
});

test('the write has landed by the time it resolves', async () => {
  await browser.storage.local.set(v5Settings());

  await update6_0_0();

  /**
   * Read the fake's store directly, with no flush in between: the updater
   * stamps the new version straight after this resolves, so a write still in
   * flight would be a lost migration.
   */
  expect(browser.storage.local.items.illustRenameRule)
    .toBe('illust/{userName}/{id}_{title}/p{pageNum}');
});
