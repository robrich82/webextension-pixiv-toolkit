const { ImageDecrypte } = require('../src/modules/Parser/PixivComic/ImageDecrypte');
const { decrypteKey } = require('../src/modules/Parser/PixivComic/config');

// The shuffle table is seeded from a SHA-256 of the two keys, and jest's node
// environment has no `crypto` global for that.
if (!globalThis.crypto) {
  globalThis.crypto = require('crypto').webcrypto;
}

const BYTES_PER_PIXEL = 4;
const PAGE_KEY = 'aaaaaaaaaaaaaaaa';

/**
 * A block of pixel data whose bytes are all distinct enough to tell apart, so
 * a column that moved can be identified by its contents.
 */
const pixels = (width, height) => {
  const data = new Uint8ClampedArray(width * height * BYTES_PER_PIXEL);

  for (let i = 0; i < data.length; i++) {
    data[i] = i % 251;
  }

  return data;
};

const shuffle = (data, width, height, gridsize, reverse, key = PAGE_KEY) =>
  ImageDecrypte(data, BYTES_PER_PIXEL, width, height, gridsize, gridsize, decrypteKey, key, reverse);

describe('unscrambling', () => {
  test('reverses the scramble it applies', async () => {
    // The api serves images with their columns shuffled; the viewer puts them
    // back. Scrambling and unscrambling with the same key has to be a
    // round trip, or every downloaded comic page comes out sliced.
    const original = pixels(8, 4);

    const scrambled = await shuffle(original, 8, 4, 2, false);
    const restored = await shuffle(scrambled, 8, 4, 2, true);

    expect(Array.from(restored)).toEqual(Array.from(original));
  });

  test('actually moves the columns around', async () => {
    // Guards against the round trip above passing because both directions are
    // no-ops.
    const original = pixels(8, 4);

    const scrambled = await shuffle(original, 8, 4, 2, false);

    expect(Array.from(scrambled)).not.toEqual(Array.from(original));
  });

  test('is deterministic for a given key', async () => {
    const original = pixels(8, 4);

    const first = await shuffle(original, 8, 4, 2, false);
    const second = await shuffle(original, 8, 4, 2, false);

    expect(Array.from(first)).toEqual(Array.from(second));
  });

  test('a different page key gives a different arrangement', async () => {
    // The key comes back per page in the read_v4 response, so using the wrong
    // one has to be visible rather than silently producing the same image.
    const original = pixels(8, 4);

    const first = await shuffle(original, 8, 4, 2, false, 'aaaaaaaaaaaaaaaa');
    const second = await shuffle(original, 8, 4, 2, false, 'bbbbbbbbbbbbbbbb');

    expect(Array.from(first)).not.toEqual(Array.from(second));
  });

  test('leaves the remainder columns at the right edge alone', async () => {
    // 9 pixels wide with a grid of 2 leaves one column outside the shuffled
    // region, which is copied straight through.
    const width = 9;
    const original = pixels(width, 2);

    const scrambled = await shuffle(original, width, 2, 2, false);

    const lastColumnOf = data => [0, 1].map(row => {
      const start = (row * width + 8) * BYTES_PER_PIXEL;
      return Array.from(data.slice(start, start + BYTES_PER_PIXEL));
    });

    expect(lastColumnOf(scrambled)).toEqual(lastColumnOf(original));
  });

  test('returns clamped bytes, which is what ImageData takes', async () => {
    const result = await shuffle(pixels(8, 4), 8, 4, 2, false);

    expect(result).toBeInstanceOf(Uint8ClampedArray);
  });
});

describe('argument validation', () => {
  test.each([
    ['a zero bytesPerElement', [pixels(8, 4), 0, 8, 4, 2, 2]],
    ['a zero width', [pixels(8, 4), BYTES_PER_PIXEL, 0, 4, 2, 2]],
    ['a zero height', [pixels(8, 4), BYTES_PER_PIXEL, 8, 0, 2, 2]],
    ['a zero block size', [pixels(8, 4), BYTES_PER_PIXEL, 8, 4, 0, 2]],
  ])('rejects %s', async (_name, args) => {
    await expect(ImageDecrypte(...args, decrypteKey, PAGE_KEY, true)).rejects.toThrow();
  });

  test('rejects a fractional dimension', async () => {
    await expect(
      ImageDecrypte(pixels(8, 4), BYTES_PER_PIXEL, 8.5, 4, 2, 2, decrypteKey, PAGE_KEY, true)
    ).rejects.toThrow('Number.isSafeInteger');
  });

  test('rejects data that is not width * height * bytesPerElement long', async () => {
    // The dimensions come from the api response while the data comes from the
    // canvas, so a mismatch means the two disagree — worth failing on rather
    // than reading past the end of the buffer.
    await expect(
      shuffle(pixels(8, 4), 8, 5, 2, true)
    ).rejects.toThrow('data.length !== width * height * bytesPerElement');
  });
});
