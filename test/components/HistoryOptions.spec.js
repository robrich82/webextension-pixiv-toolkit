import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import HistoryOptions from '@/options_page/components/options/HistoryOptions.vue';

const browserItems = {
  enableSaveVisitHistory: true,
  enableSaveDownloadHistory: 2,
  displayWorkTypeLabel: false,
  notSaveNSFWWorkInHistory: true,
  maxHistoryItems: 5000,
  workCoverSize: 2,
  historyBackup: [{ id: 1 }, { id: 2 }]
};

describe('HistoryOptions', () => {
  test('adopts every stored value before mount', () => {
    const wrapper = shallowMountOption(HistoryOptions, { browserItems });

    expect(wrapper.vm.enableSaveVisitHistory).toBe(true);
    expect(wrapper.vm.enableSaveDownloadHistory).toBe(2);
    expect(wrapper.vm.displayWorkTypeLabel).toBe(false);
    expect(wrapper.vm.notSaveNSFWWorkInHistory).toBe(true);
    expect(wrapper.vm.maxHistoryItems).toBe(5000);
    expect(wrapper.vm.workCoverSize).toBe(2);
  });

  test('historyBackupCount reflects the stored backup, or 0 when there is none', () => {
    const withBackup = shallowMountOption(HistoryOptions, { browserItems });
    expect(withBackup.vm.historyBackupCount).toBe(2);

    const withoutBackup = shallowMountOption(HistoryOptions, {
      browserItems: { ...browserItems, historyBackup: undefined }
    });
    expect(withoutBackup.vm.historyBackupCount).toBe(0);
  });

  test('importProgress reports the percentage of items already consumed', () => {
    const wrapper = shallowMountOption(HistoryOptions, { browserItems });

    wrapper.vm.importCount = 100;
    wrapper.vm.importItems = new Array(25);

    expect(wrapper.vm.importProgress).toBe(75);
  });

  test.each([
    ['enableSaveVisitHistory', false, 'enableSaveVisitHistory'],
    ['enableSaveDownloadHistory', 0, 'enableSaveDownloadHistory'],
    ['displayWorkTypeLabel', true, 'displayWorkTypeLabel'],
    ['notSaveNSFWWorkInHistory', false, 'notSaveNSFWWorkInHistory']
  ])('persists a change to %s', async (dataKey, newValue, storageKey) => {
    const wrapper = shallowMountOption(HistoryOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm[dataKey] = newValue;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items[storageKey]).toBe(newValue);
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

  describe('exportVisitHistory', () => {
    test('starts an export when idle', () => {
      const wrapper = shallowMountOption(HistoryOptions, { browserItems });

      wrapper.vm.exportVisitHistory();

      expect(wrapper.vm.exporting).toBe(true);
    });

    test('is a no-op while already exporting or importing', () => {
      const wrapper = shallowMountOption(HistoryOptions, { browserItems });
      wrapper.vm.importing = true;

      wrapper.vm.exportVisitHistory();

      expect(wrapper.vm.exporting).toBe(false);
    });
  });

  describe('importVisitHistoryData', () => {
    test('feeds the port up to 100 items at a time and drains the queue', () => {
      const saveBatchHistories = jest.fn();
      const wrapper = shallowMountOption(HistoryOptions, { browserItems });
      wrapper.vm.visitHistoryPort = { saveBatchHistories };
      wrapper.vm.importItems = new Array(120).fill(0).map((_, i) => ({ id: i }));

      wrapper.vm.importVisitHistoryData();

      expect(wrapper.vm.importing).toBe(true);
      expect(wrapper.vm.importItems).toHaveLength(20);
      expect(saveBatchHistories).toHaveBeenCalledWith({ items: expect.arrayContaining([{ id: 0 }]) });
      expect(saveBatchHistories.mock.calls[0][0].items).toHaveLength(100);
    });

    test('stops importing once the queue is empty', () => {
      const wrapper = shallowMountOption(HistoryOptions, { browserItems });
      wrapper.vm.importItems = [];

      wrapper.vm.importVisitHistoryData();

      expect(wrapper.vm.importing).toBe(false);
    });
  });

  test('recoveryHistory loads the stored backup and starts importing it, after confirming', () => {
    const saveBatchHistories = jest.fn();
    window.confirm = jest.fn(() => true);
    // importVisitHistoryData drains this.importItems in place, and
    // recoveryHistory points it straight at browserItems.historyBackup, so
    // this test gets its own backup array rather than mutating the shared one.
    const backup = [{ id: 1 }, { id: 2 }];
    const wrapper = shallowMountOption(HistoryOptions, {
      browserItems: { ...browserItems, historyBackup: backup }
    });
    wrapper.vm.visitHistoryPort = { saveBatchHistories };

    wrapper.vm.recoveryHistory();

    expect(window.confirm).toHaveBeenCalled();
    expect(saveBatchHistories).toHaveBeenCalledWith({ items: [{ id: 1 }, { id: 2 }] });
  });

  test('recoveryHistory does nothing without confirmation', () => {
    window.confirm = jest.fn(() => false);
    const wrapper = shallowMountOption(HistoryOptions, { browserItems });

    wrapper.vm.recoveryHistory();

    expect(wrapper.vm.importing).toBe(false);
    expect(wrapper.vm.importItems).toEqual([]);
  });

  // visitHistoryPort is never assigned anywhere in this codebase (grep confirms
  // it), so the real "Clear" button throws today rather than clearing anything.
  // This documents that pre-existing gap rather than papering over it.
  test('clearHistory throws today: visitHistoryPort is never wired up', () => {
    const wrapper = shallowMountOption(HistoryOptions, { browserItems });

    expect(() => wrapper.vm.clearHistory()).toThrow();
  });
});
