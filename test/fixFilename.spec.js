const { fixFilename } = require('../src/modules/Util/fixFilename');

test('escapes a leading dot so the file is not written as hidden', () => {
  expect(fixFilename('.hidden.jpg')).toBe('[.]hidden.jpg');
});

test('leaves a normal filename untouched', () => {
  expect(fixFilename('artwork.jpg')).toBe('artwork.jpg');
});

test('leaves an interior dot untouched', () => {
  expect(fixFilename('my.artwork.jpg')).toBe('my.artwork.jpg');
});

test('escapes only the first of several leading dots', () => {
  expect(fixFilename('..jpg')).toBe('[.].jpg');
});
