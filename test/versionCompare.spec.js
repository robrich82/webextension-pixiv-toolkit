const versionCompare = require('../src/modules/Util/versionCompare');

describe('ordering', () => {
  test('reports a newer version as greater', () => {
    expect(versionCompare('6.4.2', '6.4.1')).toBe(1);
  });

  test('reports an older version as lesser', () => {
    expect(versionCompare('6.4.1', '6.4.2')).toBe(-1);
  });

  test('reports equal versions as equal', () => {
    expect(versionCompare('6.4.2', '6.4.2')).toBe(0);
  });

  test('compares parts numerically, not as strings', () => {
    // A string comparison would put '10' before '9', which is the classic way
    // a version gate silently stops firing.
    expect(versionCompare('6.10.0', '6.9.0')).toBe(1);
  });
});

describe('differing part counts', () => {
  test('a longer version with extra parts is greater', () => {
    expect(versionCompare('6.4.2.1', '6.4.2')).toBe(1);
  });

  test('a shorter version is lesser', () => {
    expect(versionCompare('6.4', '6.4.2')).toBe(-1);
  });

  test('zeroExtend pads the shorter version so 6.4 equals 6.4.0', () => {
    expect(versionCompare('6.4', '6.4.0', { zeroExtend: true })).toBe(0);
  });
});

describe('invalid input', () => {
  test('returns NaN for a non-numeric part', () => {
    expect(versionCompare('6.4.beta', '6.4.2')).toBeNaN();
  });

  test('returns NaN for an empty string', () => {
    expect(versionCompare('', '6.4.2')).toBeNaN();
  });

  test('lexicographical mode accepts a trailing letter', () => {
    expect(versionCompare('6.4.2a', '6.4.2', { lexicographical: true })).toBe(1);
  });
});
