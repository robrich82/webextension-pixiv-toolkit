const DateFormatter = require('../src/modules/Util/DateFormatter').default;

// Pixiv serves ISO 8601 timestamps with a UTC offset, but the getters below
// read local-time fields. Fixtures therefore use a plain local-time string, so
// these tests do not depend on the timezone of the machine running them.
const format = date => DateFormatter.getDefault(date);

test('getYear returns a four digit year', () => {
  expect(format('2024-03-07T10:20:30').getYear()).toBe('2024');
});

test('getMonth is 1-based and zero padded', () => {
  // Date#getMonth is 0-based; the +1 in the implementation is exactly the kind
  // of off-by-one that would quietly file every download under the wrong month.
  expect(format('2024-03-07T10:20:30').getMonth()).toBe('03');
});

test('getDay is zero padded', () => {
  expect(format('2024-03-07T10:20:30').getDay()).toBe('07');
});

test('does not pad a two digit month or day', () => {
  const d = format('2024-11-23T10:20:30');

  expect(d.getMonth()).toBe('11');
  expect(d.getDay()).toBe('23');
});

test('handles the last day of December without rolling the year', () => {
  const d = format('2024-12-31T23:59:59');

  expect([d.getYear(), d.getMonth(), d.getDay()]).toEqual(['2024', '12', '31']);
});

describe('getDefault validation', () => {
  // The guard used to read `Date.parse(date) === NaN`, which is always false,
  // so an unparseable date reached the getters and formatted as NaN.
  test.each([
    ['a non-date string', 'not a date'],
    ['an empty string', ''],
    ['undefined', undefined],
    ['null', null],
  ])('rejects %s', (_name, date) => {
    expect(() => DateFormatter.getDefault(date)).toThrow('Invalid date time');
  });

  test('accepts a valid date', () => {
    expect(() => DateFormatter.getDefault('2024-03-07T10:20:30')).not.toThrow();
  });

  test('the constructor still accepts anything, unvalidated', () => {
    // Fanbox's PostParser uses `new DateFormatter(...)` directly rather than
    // getDefault, so it deliberately keeps the old, unguarded behaviour.
    expect(() => new DateFormatter('not a date')).not.toThrow();
  });
});
