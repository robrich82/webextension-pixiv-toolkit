const MimeType = require('../src/modules/Util/MimeType').default;

describe('getExtenstion', () => {
  test('maps a known mime type to its extension', () => {
    expect(MimeType.getExtenstion('image/png')).toBe('png');
  });

  test('is case insensitive', () => {
    expect(MimeType.getExtenstion('IMAGE/PNG')).toBe('png');
  });

  test('ignores parameters after the mime type', () => {
    expect(MimeType.getExtenstion('text/html; charset=utf-8')).toBe('html');
  });

  test('returns null for an unknown mime type', () => {
    expect(MimeType.getExtenstion('application/octet-stream')).toBeNull();
  });

  test('image/jpeg resolves to jpg', () => {
    // `types` declares 'image/jpeg' twice, as 'jpeg' then 'jpg'. The later key
    // wins, so 'jpeg' is unreachable as an extension. Pinned here so removing
    // the duplicate cannot silently change what downloads are named.
    expect(MimeType.getExtenstion('image/jpeg')).toBe('jpg');
  });
});

describe('getMimeType', () => {
  test('maps an extension back to its mime type', () => {
    expect(MimeType.getMimeType('png')).toBe('image/png');
  });

  test('returns an empty string for an unknown extension', () => {
    expect(MimeType.getMimeType('exe')).toBe('');
  });

  test('jpeg has no mime type, because jpg overwrote it', () => {
    expect(MimeType.getMimeType('jpeg')).toBe('');
  });
});

describe('file helpers', () => {
  test('getFileExtension takes the part after the last dot', () => {
    expect(MimeType.getFileExtension('my.artwork.png')).toBe('png');
  });

  test('getFileMimeType resolves a filename to its mime type', () => {
    expect(MimeType.getFileMimeType('artwork.png')).toBe('image/png');
  });

  test('getFileExtension returns the whole name when there is no dot', () => {
    expect(MimeType.getFileExtension('artwork')).toBe('artwork');
  });
});
