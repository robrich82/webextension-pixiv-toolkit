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

  it.each([
    ['00:00', '凌晨'],
    ['05:59', '凌晨'],
    ['06:00', '早上'],
    ['08:59', '早上'],
    ['09:00', '上午'],
    ['10:45', '上午'],
    ['11:29', '上午'],
    ['11:30', '中午'],
    ['12:29', '中午'],
    ['12:30', '下午'],
    ['12:45', '下午'],
    ['17:59', '下午'],
    ['18:00', '晚上'],
  ])('labels %s as %s', (time, label) => {
    expect(moment.utc(`1970-01-01T${time}`).locale('zh_CN').format('A')).toBe(label);
  });
});
