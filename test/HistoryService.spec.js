/**
 * The background history service, driven the way the options page drives it:
 * `runtime.sendMessage` into `Application.onMessage`, down to a real Dexie
 * database.
 */
import './helpers/fakeIndexedDb';
import browser from './doubles/browser';
import Application from '@/background/Application';
import HistoryService from '@/background/services/HistoryService';
import Db from '@/modules/Db/Db';
import HistoryRepo from '@/modules/Db/Repository/HistoryRepo';

const send = (action, args) => browser.runtime.sendMessage({ to: 'ws', action, args });

const entry = (id, visited_at, overrides) => ({
  uid: `pixiv_illust:${id}`, title: `Work ${id}`, url: `https://www.pixiv.net/artworks/${id}`,
  cover: '', type: 'pixiv_illust', r: false, visited_at, ...overrides
});

const storedUids = async () => (await Db.getDb().historyRepo().getItems({ page: 1, count: 100 })).map(i => i.uid);

describe('HistoryService', () => {
  let app;

  beforeEach(() => {
    Application.instance = undefined;
    HistoryService.instance = undefined;
    Db.instance = undefined;
    HistoryRepo.instance = undefined;

    app = Application.createApp();
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => app.onMessage(message, sender, sendResponse));
  });

  afterEach(async () => {
    await Db.getDb().database.delete();
  });

  describe('history:importItems', () => {
    test('stores current and v5 entries and reports what it skipped', async () => {
      const result = await send('history:importItems', {
        items: [
          entry(1, 300),
          { id: '2', title: 'Old', type: 2, r: false, images: { thumb: '' }, viewed_at: 200 },
          { title: 'not an entry' },
          null
        ]
      });

      expect(result).toEqual({ imported: 2, skipped: 2 });
      expect(await storedUids()).toEqual(['pixiv_illust:1', 'pixiv_illust:2']);
    });

    test('keeps NSFW entries even when visits skip them', async () => {
      app.settings.notSaveNSFWWorkInHistory = true;

      await send('history:importItems', { items: [entry(1, 100, { r: true })] });

      expect(await storedUids()).toEqual(['pixiv_illust:1']);
    });

    test('applies the maxHistoryItems setting, even stored as a string', async () => {
      app.settings.maxHistoryItems = '2';

      await send('history:importItems', { items: [entry(1, 100), entry(2, 300), entry(3, 200)] });

      expect(await storedUids()).toEqual(['pixiv_illust:2', 'pixiv_illust:3']);
    });

    test('falls back to 10000 for an unusable maxHistoryItems', async () => {
      app.settings.maxHistoryItems = 'abc';

      await send('history:importItems', { items: [entry(1, 100), entry(2, 200)] });

      expect(Db.getDb().historyRepo().max).toBe(10000);
    });

    test('answers for a message with no items', async () => {
      expect(await send('history:importItems', {})).toEqual({ imported: 0, skipped: 0 });
    });
  });

  test('visits are capped by maxHistoryItems too', async () => {
    app.settings.maxHistoryItems = 1;

    await send('history:itemVisit', entry(1, 100));
    await send('history:itemVisit', entry(2, 200));

    expect(await storedUids()).toEqual(['pixiv_illust:2']);
  });

  test('history:clear empties the table', async () => {
    await send('history:importItems', { items: [entry(1, 100), entry(2, 200)] });

    expect(await send('history:clear')).toBe(true);

    expect(await Db.getDb().historyRepo().table.count()).toBe(0);
  });
});
