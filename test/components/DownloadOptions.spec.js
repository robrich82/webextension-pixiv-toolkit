import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import DownloadOptions from '@/options_page/components/options/DownloadOptions.vue';

const browserItems = {
  downloadRelativeLocation: 'pixiv/',
  enableDownloadMetadata: true,
  downloadSaveAs: true,
  downloadTasksWhenDownloadingImages: 2,
  maxProcessDownloadTasks: 3,
  multipleDownloadsGapTime: 200
};

describe('DownloadOptions', () => {
  test('adopts every stored value on creation', () => {
    const wrapper = shallowMountOption(DownloadOptions, { browserItems });

    expect(wrapper.vm.downloadRelativeLocation).toBe('pixiv/');
    expect(wrapper.vm.enableDownloadMetadata).toBe(true);
    expect(wrapper.vm.downloadSaveAs).toBe(true);
    expect(wrapper.vm.downloadTasksWhenDownloadingImages).toBe(2);
    expect(wrapper.vm.maxProcessDownloadTasks).toBe(3);
    expect(wrapper.vm.multipleDownloadsGapTime).toBe(200);
  });

  test('falls back to a 150ms gap when the stored value is not a number', () => {
    const wrapper = shallowMountOption(DownloadOptions, {
      browserItems: { ...browserItems, multipleDownloadsGapTime: undefined }
    });

    expect(wrapper.vm.multipleDownloadsGapTime).toBe(150);
  });

  test('the relative-location preview reports "not set" when empty', () => {
    const wrapper = shallowMountOption(DownloadOptions, {
      browserItems: { ...browserItems, downloadRelativeLocation: '' }
    });

    expect(wrapper.vm.downloadRelativeLocationPreview).toBe('_not_set.message');
  });

  test('the relative-location preview echoes a set location', () => {
    const wrapper = shallowMountOption(DownloadOptions, { browserItems });

    expect(wrapper.vm.downloadRelativeLocationPreview).toBe('pixiv/');
  });

  test('openDownloadRelativeLocationDialog opens the dialog', () => {
    const wrapper = shallowMountOption(DownloadOptions, { browserItems });

    wrapper.vm.openDownloadRelativeLocationDialog();

    expect(wrapper.vm.showDownloadRelativeLocationDialog).toBe(true);
  });

  test.each([
    ['downloadSaveAs', false, 'downloadSaveAs'],
    ['enableDownloadMetadata', false, 'enableDownloadMetadata']
  ])('persists a change to %s', async (dataKey, newValue, storageKey) => {
    const wrapper = shallowMountOption(DownloadOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm[dataKey] = newValue;
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items[storageKey]).toBe(newValue);
  });

  test('persists a valid multipleDownloadsGapTime as an integer', async () => {
    const wrapper = shallowMountOption(DownloadOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.multipleDownloadsGapTime = '500';
    await wrapper.vm.$nextTick();

    expect(browser.storage.local.items.multipleDownloadsGapTime).toBe(500);
  });

  test('clamps maxProcessDownloadTasks up to 1 and persists the clamped value', async () => {
    const wrapper = shallowMountOption(DownloadOptions, { browserItems });
    await wrapper.vm.$nextTick();

    wrapper.vm.maxProcessDownloadTasks = 0;
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.maxProcessDownloadTasks).toBe(1);
    expect(browser.storage.local.items.maxProcessDownloadTasks).toBe(1);
  });

  describe('onDownloadRelativeLocationFieldBlurHandler', () => {
    test('persists a valid relative location and remembers it as the fallback', async () => {
      const wrapper = shallowMountOption(DownloadOptions, {
        browserItems: { ...browserItems, downloadRelativeLocation: 'first/' }
      });

      wrapper.vm.downloadRelativeLocation = 'second/nested/';
      wrapper.vm.onDownloadRelativeLocationFieldBlurHandler();
      await browser._fake.flush();

      expect(browser.storage.local.items.downloadRelativeLocation).toBe('second/nested/');
      expect(wrapper.vm.oldDownloadRelativeLocation).toBe('second/nested/');
    });

    test('reverts an invalid relative location to the last valid one', () => {
      const wrapper = shallowMountOption(DownloadOptions, {
        browserItems: { ...browserItems, downloadRelativeLocation: 'first/' }
      });

      wrapper.vm.downloadRelativeLocation = 'not.valid/';
      wrapper.vm.onDownloadRelativeLocationFieldBlurHandler();

      expect(wrapper.vm.downloadRelativeLocation).toBe('first/');
      expect(browser.storage.local.items.downloadRelativeLocation).toBeUndefined();
    });
  });

  test('hint flags an invalid relative location through downloadRelativeFieldErrorMessages', () => {
    const wrapper = shallowMountOption(DownloadOptions, {
      browserItems: { ...browserItems, downloadRelativeLocation: 'bad.value/' }
    });

    void wrapper.vm.hint;

    expect(wrapper.vm.downloadRelativeFieldErrorMessages).toEqual([
      'Invalid input, example: "pixiv_downloads/"'
    ]);
  });
});
