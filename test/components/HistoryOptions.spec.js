import '../helpers/fakeIndexedDb';
import { flushPromises } from '@vue/test-utils';
import browser from '../doubles/browser';
import { mountOption, shallowMountOption } from '../helpers/mountOptionComponent';
import HistoryOptions from '@/options_page/components/options/HistoryOptions.vue';
import Application from '@/background/Application';
import HistoryService from '@/background/services/HistoryService';
import Db from '@/modules/Db/Db';
import HistoryRepo from '@/modules/Db/Repository/HistoryRepo';

const browserItems = {
  enableSaveVisitHistory: true,
  enableSaveDownloadHistory: 2,
  displayWorkTypeLabel: false,
  notSaveNSFWWorkInHistory: true,
  maxHistoryItems: 5000,
  workCoverSize: 2
};

describe('HistoryOptions', () => {
  afterEach(() => {
    delete window.confirm;
  });

  // shallowMount stubs `v-list-item` and only renders its default slot, so it
  // can't see this component's `#title`/`#subtitle`/`#append` named slots
  // (see DownloadSaveMode.spec.js for the same pattern).
  test('renders the title through the migrated named slots', () => {
    const wrapper = mountOption(HistoryOptions, { browserItems });

    expect(wrapper.text()).toContain('Enable_save_visit_history.message');
  });

  test('the import progress dialog is persistent, as a boolean', () => {
    const wrapper = mountOption(HistoryOptions, { browserItems });
    const dialog = wrapper.findAllComponents({ name: 'VDialog' })
      .find(d => String(d.props('width')) === '250');

    expect(dialog.props('persistent')).toBe(true);
  });

  test('adopts every stored value before mount', () => {
    const wrapper = shallowMountOption(HistoryOptions, { browserItems });

    expect(wrapper.vm.enableSaveVisitHistory).toBe(true);
    expect(wrapper.vm.enableSaveDownloadHistory).toBe(2);
    expect(wrapper.vm.displayWorkTypeLabel).toBe(false);
    expect(wrapper.vm.notSaveNSFWWorkInHistory).toBe(true);
    expect(wrapper.vm.maxHistoryItems).toBe(5000);
    expect(wrapper.vm.workCoverSize).toBe(2);
  });

  test('importProgress reports the percentage of entries already sent', () => {
    const wrapper = shallowMountOption(HistoryOptions, { browserItems });

    wrapper.vm.importCount = 100;
    wrapper.vm.importedCount = 75;

    expect(wrapper.vm.importProgress).toBe(75);
  });

  test('importProgress is 0 before an import has a size', () => {
    const wrapper = shallowMountOption(HistoryOptions, { browserItems });

    expect(wrapper.vm.importProgress).toBe(0);
  });

  test.each([
    ['enableSaveVisitHistory', false],
    ['enableSaveDownloadHistory', 0],
    ['displayWorkTypeLabel', true],
    ['notSaveNSFWWorkInHistory', false]
  ])('persists a change to %s', async (key, newValue) => {
    const wrapper = shallowMountOption(HistoryOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm[key] = newValue;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items[key]).toBe(newValue);
  });

  test('workCoverSize is coerced to a number before it is persisted', async () => {
    const wrapper = shallowMountOption(HistoryOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.workCoverSize = '3';
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.workCoverSize).toBe(3);
  });

  test('maxHistoryItems persists a positive integer', async () => {
    const wrapper = shallowMountOption(HistoryOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.maxHistoryItems = '20000';
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.maxHistoryItems).toBe('20000');
  });

  test('maxHistoryItems resets to 10000 for a non-positive-integer value', async () => {
    const wrapper = shallowMountOption(HistoryOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.maxHistoryItems = '-5';
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.maxHistoryItems).toBe(10000);
  });

  test('exportVisitHistory is a no-op while importing', async () => {
    const wrapper = shallowMountOption(HistoryOptions, { browserItems });
    wrapper.vm.importing = true;

    await wrapper.vm.exportVisitHistory();

    expect(wrapper.vm.exporting).toBe(false);
  });

  /**
   * These go all the way through: the component's runtime.sendMessage reaches
   * the real background Application and HistoryService, which write to Dexie
   * on fake-indexeddb.
   */
  describe('against the background history service', () => {
    const entry = (id, visited_at) => ({
      uid: `pixiv_illust:${id}`, title: `Work ${id}`, url: `https://www.pixiv.net/artworks/${id}`,
      cover: '', type: 'pixiv_illust', r: false, visited_at
    });
    const legacy = (id, viewed_at) => ({
      id: String(id), title: `Old ${id}`, type: 0, r: false, images: { thumb: '' }, viewed_at
    });
    const storedUids = async () =>
      (await Db.getDb().historyRepo().getItems({ page: 1, count: 2000 })).map(i => i.uid);

    // Captures the file input importVisitHistory creates; the returned
    // function "picks" a file with `contents` and waits for the import.
    const chooseFile = contents => {
      let input;
      const createElement = document.createElement.bind(document);

      vi.spyOn(document, 'createElement').mockImplementation(tag => {
        const element = createElement(tag);

        if (tag === 'input') {
          input = element;
          element.click = vi.fn();
        }

        return element;
      });

      return {
        input: () => input,
        pick: async () => {
          Object.defineProperty(input, 'files', { value: [{ text: async () => contents }] });
          input.dispatchEvent(new Event('change'));
          await flushPromises();
          // Each batch's reply only comes once the background has written it.
          await Promise.all(browser.runtime.sendMessage.mock.results.map(result => result.value));
          await flushPromises();
        }
      };
    };

    beforeEach(() => {
      Application.instance = undefined;
      HistoryService.instance = undefined;
      Db.instance = undefined;
      HistoryRepo.instance = undefined;

      const app = Application.createApp();
      browser.runtime.onMessage.addListener((message, sender, sendResponse) => app.onMessage(message, sender, sendResponse));

      window.confirm = vi.fn(() => true);
      window.alert = vi.fn();
    });

    afterEach(async () => {
      delete window.alert;
      vi.restoreAllMocks();
      await Db.getDb().database.delete();
    });

    test('Import adds the chosen file to the history the History page reads', async () => {
      const wrapper = shallowMountOption(HistoryOptions, { browserItems });
      const file = chooseFile(JSON.stringify([entry(1, 100), legacy(2, 200)]));

      wrapper.vm.importVisitHistory();
      await file.pick();

      expect(await storedUids()).toEqual(['pixiv_illust:2', 'pixiv_illust:1']);
      expect(wrapper.vm.importing).toBe(false);
      expect(window.alert).not.toHaveBeenCalled();
    });

    test('Import sends a large file in batches and reports progress', async () => {
      const wrapper = shallowMountOption(HistoryOptions, { browserItems });
      const items = Array.from({ length: 1200 }, (_, i) => entry(i + 1, i + 1));
      const sendMessage = browser.runtime.sendMessage;

      await wrapper.vm.importHistoryItems(items);

      expect(sendMessage.mock.calls.map(([message]) => message.args.items.length)).toEqual([500, 500, 200]);
      expect(wrapper.vm.importedCount).toBe(1200);
      expect(wrapper.vm.importProgress).toBe(100);
      expect(await Db.getDb().historyRepo().table.count()).toBe(1200);
    });

    test.each([
      ['not JSON', '{oops'],
      ['not a list', '{"uid":"pixiv_illust:1"}'],
      ['a list with no history entries', '[{"title":"x"}]']
    ])('Import of a file that is %s says the file is invalid', async (_, contents) => {
      const wrapper = shallowMountOption(HistoryOptions, { browserItems });
      const file = chooseFile(contents);

      wrapper.vm.importVisitHistory();
      await file.pick();

      expect(window.alert).toHaveBeenCalledWith('Invalid import file');
      expect(await storedUids()).toEqual([]);
      expect(wrapper.vm.importing).toBe(false);
    });

    test('Import does not open the file picker without confirmation', () => {
      window.confirm = vi.fn(() => false);
      const wrapper = shallowMountOption(HistoryOptions, { browserItems });
      const file = chooseFile('[]');

      wrapper.vm.importVisitHistory();

      expect(file.input().click).not.toHaveBeenCalled();
    });

    test('a background that does not answer ends the import with an error', async () => {
      const wrapper = shallowMountOption(HistoryOptions, { browserItems });
      browser.runtime.sendMessage.mockResolvedValueOnce(undefined);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await wrapper.vm.importAndReport([entry(1, 100)]);

      expect(window.alert).toHaveBeenCalledWith('_unknown_error.message');
      expect(wrapper.vm.importing).toBe(false);
    });

    test('a Clear the background fails says so', async () => {
      browser.runtime.sendMessage.mockResolvedValueOnce(undefined);
      const wrapper = shallowMountOption(HistoryOptions, { browserItems });

      await wrapper.vm.clearHistory();

      expect(window.alert).toHaveBeenCalledWith('_unknown_error.message');
    });

    describe('Export', () => {
      // Captures what the download is made from, and stops the click navigating.
      const captureDownload = () => {
        const download = {};

        vi.spyOn(global, 'Blob').mockImplementation(function (parts, options) {
          download.contents = parts.join('');
          download.type = options.type;
        });
        URL.createObjectURL = vi.fn(() => 'blob:history');
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
          download.href = this.href;
          download.filename = this.download;
        });

        return download;
      };

      afterEach(() => {
        delete URL.createObjectURL;
      });

      test('downloads every entry, newest visit first, without database ids', async () => {
        await Db.getDb().historyRepo().importItems([entry(1, 100), entry(2, 300), entry(3, 200)]);
        const download = captureDownload();
        const wrapper = shallowMountOption(HistoryOptions, { browserItems });

        await wrapper.vm.exportVisitHistory();

        const exported = JSON.parse(download.contents);
        expect(exported.map(item => item.uid)).toEqual(['pixiv_illust:2', 'pixiv_illust:3', 'pixiv_illust:1']);
        expect(exported[0]).toEqual(entry(2, 300));
        expect(download.type).toBe('application/json');
        expect(download.href).toBe('blob:history');
        expect(download.filename).toMatch(/^pixiv_toolkit_history-\d+\.json$/);
        expect(wrapper.vm.exporting).toBe(false);
      });

      test('an exported file imports back to the same history', async () => {
        await Db.getDb().historyRepo().importItems([entry(1, 100), { ...entry(2, 300), downloaded_at: 250, r: true }]);
        const before = await Db.getDb().historyRepo().exportItems();
        const download = captureDownload();
        const wrapper = shallowMountOption(HistoryOptions, { browserItems });

        await wrapper.vm.exportVisitHistory();
        await Db.getDb().historyRepo().clear();
        const file = chooseFile(download.contents);
        wrapper.vm.importVisitHistory();
        await file.pick();

        expect(await Db.getDb().historyRepo().exportItems()).toEqual(before);
      });

      test('a failed export says so and lets Import run again', async () => {
        vi.spyOn(Db.getDb().historyRepo(), 'exportItems').mockRejectedValue(new Error('closed'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const wrapper = shallowMountOption(HistoryOptions, { browserItems });

        await wrapper.vm.exportVisitHistory();

        expect(window.alert).toHaveBeenCalledWith('_unknown_error.message');
        expect(wrapper.vm.exporting).toBe(false);
      });
    });

    test('Clear empties the history the History page reads', async () => {
      await Db.getDb().historyRepo().importItems([entry(1, 100), entry(2, 200)]);
      const wrapper = shallowMountOption(HistoryOptions, { browserItems });
      wrapper.vm.confirmDialog = true;

      await wrapper.vm.clearHistory();

      expect(await storedUids()).toEqual([]);
      expect(wrapper.vm.confirmDialog).toBe(false);
      expect(window.alert).not.toHaveBeenCalled();
    });
  });
});
