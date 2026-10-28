import { flushPromises } from '@vue/test-utils';
import { installFakeXhr } from '../doubles/xhr';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import ChangeLog from '@/options_page/components/ChangeLog.vue';

const history = 'v2.0.0\nAdd a thing;\nFix a bug.\n\nv1.0.0\nFirst release.\n';

describe('ChangeLog', () => {
  let xhr;
  let body;

  beforeEach(() => {
    body = history;
    xhr = installFakeXhr(() => body);
  });

  afterEach(() => {
    xhr.restore();
  });

  const mountChangeLog = locale => shallowMountOption(ChangeLog, { mocks: { $i18n: { locale } } });

  test('renders each version with its entries', async () => {
    const wrapper = mountChangeLog('en');
    await flushPromises();

    expect(wrapper.findAll('.change-log__title').map(t => t.text())).toEqual(['v2.0.0', 'v1.0.0']);
    expect(wrapper.findAll('.change-log__list').map(l => l.findAll('li').map(li => li.text())))
      .toEqual([['Add a thing;', 'Fix a bug.'], ['First release.']]);
  });

  test('handles CRLF line endings', async () => {
    body = history.replace(/\n/g, '\r\n');

    const wrapper = mountChangeLog('en');
    await flushPromises();

    expect(wrapper.vm.updateList).toEqual([
      { version: 'v2.0.0', list: ['Add a thing;', 'Fix a bug.'] },
      { version: 'v1.0.0', list: ['First release.'] }
    ]);
  });

  test.each([
    ['zh_CN', 'HISTORY_zh-CN'],
    ['en', 'HISTORY_en-US'],
    ['ja', 'HISTORY_en-US']
  ])('locale %s loads %s', async (locale, file) => {
    mountChangeLog(locale);
    await flushPromises();

    expect(xhr.urls).toEqual([expect.stringMatching(new RegExp(`/${file}$`))]);
  });
});
