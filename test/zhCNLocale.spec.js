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

  it('starts the week names on Sunday', () => {
    expect(moment.utc('1970-01-04').locale('zh_CN').format('dddd')).toBe('星期日');
  });
});
