import { flushPromises } from '@vue/test-utils';
import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import DiagnosisMessages from '@/options_page/components/DiagnosisMessages.vue';

describe('DiagnosisMessages', () => {
  test('dumps permissions, settings, the history backup and tracked errors separately', async () => {
    browser._fake.state.grantedPermissions = { permissions: ['downloads'], origins: [] };
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'log:getTrackedErrors') {
        sendResponse(['first error', 'second error']);
      }
    });

    const browserItems = { language: 'en', historyBackup: [{ id: 1 }] };
    const wrapper = shallowMountOption(DiagnosisMessages, { browserItems });
    await flushPromises();

    const [permissions, settings, historyBackup, errors] = wrapper.findAll('textarea').map(t => t.element.value);

    expect(JSON.parse(permissions)).toEqual({ permissions: ['downloads'], origins: [] });
    expect(JSON.parse(settings)).toEqual({ language: 'en' });
    expect(JSON.parse(historyBackup)).toEqual([{ id: 1 }]);
    expect(browserItems.historyBackup).toEqual([{ id: 1 }]);
    // A textarea's value normalises the component's \r\n to \n.
    expect(errors).toBe('first error\nsecond error\n');
  });

  test('leaves the errors box empty when the background has none', async () => {
    const wrapper = shallowMountOption(DiagnosisMessages, { browserItems: {} });
    await flushPromises();

    expect(wrapper.findAll('textarea')[3].element.value).toBe('');
  });
});
