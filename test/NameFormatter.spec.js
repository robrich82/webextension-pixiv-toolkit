const NameFormatter = require('../src/modules/Util/NameFormatter').default;
const formatName = require('../src/modules/Util/formatName').default;

const format = (rule, context = {}, fallback) =>
  NameFormatter.getFormatter({ context }).format(rule, fallback);

describe('meta placeholders', () => {
  test('substitutes a placeholder from the context', () => {
    expect(format('{id}', { illustId: '12345' })).toBe('12345');
  });

  test('substitutes several placeholders in one rule', () => {
    expect(format('{id}_{title}', { illustId: '12345', illustTitle: 'sunset' }))
      .toBe('12345_sunset');
  });

  test('leaves an unknown placeholder verbatim', () => {
    expect(format('{nope}', { illustId: '12345' })).toBe('{nope}');
  });

  test('leaves a known placeholder verbatim when the context lacks it', () => {
    expect(format('{title}', { illustId: '12345' })).toBe('{title}');
  });

  test('coerces a numeric context value to a string', () => {
    expect(format('{id}', { illustId: 12345 })).toBe('12345');
  });

  test('a zero value is substituted, not treated as absent', () => {
    expect(format('p{pageNum}', { pageNum: 0 })).toBe('p0');
  });

  test('falls back through possibleKeys in order', () => {
    // `illustId` is checked before `id`, so it wins when both are present.
    expect(format('{id}', { illustId: 'first', id: 'second' })).toBe('first');
  });

  test('uses a later possibleKey when the earlier one is absent', () => {
    expect(format('{id}', { postId: 'fanbox-1' })).toBe('fanbox-1');
  });

  test('does not re-expand a placeholder that came from a meta value', () => {
    // A work title containing "{id}" must survive as literal text. The offset
    // bookkeeping in format() exists for this case.
    expect(format('{title}_{id}', { illustTitle: '{id}', illustId: '99' }))
      .toBe('{id}_99');
  });
});

describe('illegal characters', () => {
  test.each([
    ['less than', 'a<b'],
    ['greater than', 'a>b'],
    ['colon', 'a:b'],
    ['double quote', 'a"b'],
    ['pipe', 'a|b'],
    ['question mark', 'a?b'],
    ['asterisk', 'a*b'],
    ['at sign', 'a@b'],
    ['hash', 'a#b'],
    ['dollar', 'a$b'],
    ['ampersand', 'a&b'],
    ['single quote', 'a\'b'],
  ])('replaces %s with an underscore', (_name, title) => {
    expect(format('{title}', { illustTitle: title })).toBe('a_b');
  });

  test('replaces every occurrence, not just the first', () => {
    expect(format('{title}', { illustTitle: 'a:b:c:d' })).toBe('a_b_c_d');
  });

  test('replaces a zero width space with a regular space', () => {
    expect(format('{title}', { illustTitle: 'a​b' })).toBe('a b');
  });

  test('a slash inside a meta value becomes an underscore, not a directory', () => {
    // The rule is split on separators *before* substitution, so a slash
    // arriving via a work title cannot escape into a parent directory.
    expect(format('{title}', { illustTitle: '../../etc/passwd' }))
      .toBe('.._.._etc_passwd');
  });
});

describe('directory rules', () => {
  test('keeps a separator that is part of the rule', () => {
    expect(format('{author}/{id}', { userName: 'artist', illustId: '12345' }))
      .toBe('artist/12345');
  });

  test('normalises a backslash separator to a forward slash', () => {
    expect(format('{author}\\{id}', { userName: 'artist', illustId: '12345' }))
      .toBe('artist/12345');
  });

  test('collapses repeated separators', () => {
    expect(format('a//b')).toBe('a/b');
  });

  test('drops a leading separator', () => {
    expect(format('/a/b')).toBe('a/b');
  });

  test('truncates each path segment to 200 characters', () => {
    const long = 'x'.repeat(250);

    expect(format('{title}/{id}', { illustTitle: long, illustId: '1' }))
      .toBe('x'.repeat(200) + '/1');
  });
});

describe('fallback', () => {
  test('returns the fallback when the rule is empty', () => {
    expect(format('', {}, 'fallback.jpg')).toBe('fallback.jpg');
  });

  test('returns the fallback when the rule is undefined', () => {
    expect(format(undefined, {}, 'fallback.jpg')).toBe('fallback.jpg');
  });

  test('returns an empty string when there is no rule and no fallback', () => {
    expect(format('')).toBe('');
  });

  test('a segment that formats to nothing becomes "undefined"', () => {
    expect(format('{title}/{id}', { illustTitle: '', illustId: '1' }))
      .toBe('undefined/1');
  });
});

describe('formatName wrapper', () => {
  test('delegates to NameFormatter', () => {
    expect(formatName('{id}_{title}', { illustId: '1', illustTitle: 'x' }))
      .toBe('1_x');
  });

  test('passes the fallback through', () => {
    expect(formatName('', {}, 'fallback.jpg')).toBe('fallback.jpg');
  });
});
