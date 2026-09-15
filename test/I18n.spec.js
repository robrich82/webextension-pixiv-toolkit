jest.mock('vue', () => ({ use: jest.fn() }));
jest.mock('vue-i18n', () => jest.fn().mockImplementation(function (options) {
  this.locale = options.locale;
}));
jest.mock('locales', () => ({ localeEn: {}, localeZhCN: {} }), { virtual: true });

const I18n = require('../src/modules/I18n').default;

test('i18n with undefined locale falls back without throwing', () => {
  expect(() => I18n.i18n(undefined, 'en-US')).not.toThrow();

  let i18n = I18n.i18n(undefined, 'en-US');

  expect(i18n.locale).toBe('en_US');
});

test('i18n with undefined locale and no fallback defaults to en', () => {
  let i18n = I18n.i18n(undefined);

  expect(i18n.locale).toBe('en');
});

test('i18n with "default" locale uses the fallback', () => {
  let i18n = I18n.i18n('default', 'zh-CN');

  expect(i18n.locale).toBe('zh_CN');
});

test('i18n with an explicit locale normalizes dashes to underscores', () => {
  let i18n = I18n.i18n('zh-CN', 'en-US');

  expect(i18n.locale).toBe('zh_CN');
});
