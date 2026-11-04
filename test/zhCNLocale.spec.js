import moment from 'moment';
import { defineZhCNLocale } from '@@/zhCNLocale';

describe('zh_CN moment locale', () => {
  beforeAll(() => {
    defineZhCNLocale();
  });

  afterAll(() => {
    moment.locale('en');
  });

  it('names 1970-01-01 as a Thursday', () => {
    expect(moment.utc('1970-01-01').locale('zh_CN').format('dddd')).toBe('星期四');
  });

  // History.vue's zh_CN date format; 1月 (not 一月) proves the custom locale, not moment's built-in zh-cn, is in use
  it('formats a Sunday with the custom months and weekdays', () => {
    expect(moment.utc('1970-01-04').locale('zh_CN').format('YYYY[年]MMMMDD[日] dddd')).toBe('1970年1月04日 星期日');
  });
});
