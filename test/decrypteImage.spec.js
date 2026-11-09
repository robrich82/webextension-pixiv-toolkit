// @vitest-environment jsdom
/**
 * decrypteImage paints the scrambled page on a canvas, unscrambles the pixels
 * and reads the canvas back. jsdom has no canvas or image decoding, so both are
 * stubbed; ImageDecrypte itself is covered in ImageDecrypte.spec.js.
 */
import { decrypteImage, ImageDecrypte } from '../src/modules/Parser/PixivComic/ImageDecrypte';
import { decrypteKey } from '../src/modules/Parser/PixivComic/config';

const page = { width: 8, height: 4, gridsize: 2, key: 'aaaaaaaaaaaaaaaa' };
const original = Uint8ClampedArray.from({ length: page.width * page.height * 4 }, (_, i) => i % 251);

let imageLoads;
let revokedBeforeLoad;
let encoded;
let context;

class FakeImage {
  set src(url) {
    setTimeout(() => {
      revokedBeforeLoad = URL.revokeObjectURL.mock.calls.length > 0;
      imageLoads ? this.onload() : this.onerror();
    });
  }
}

class FakeImageData {
  constructor(data, width, height) {
    Object.assign(this, { data, width, height });
  }
}

beforeEach(async () => {
  imageLoads = true;
  encoded = new Blob(['decrypted'], { type: 'image/png' });
  // What the api serves: the page with its columns shuffled.
  const scrambled = await ImageDecrypte(original, 4, page.width, page.height, page.gridsize, page.gridsize, decrypteKey, page.key, false);
  context = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: scrambled })),
    putImageData: vi.fn()
  };
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('ImageData', FakeImageData);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(encoded));
  vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:encrypted').mockReturnValue('blob:decrypted');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('puts back the unscrambled pixels and resolves the canvas as a blob', async () => {
  await expect(decrypteImage(page, new Blob(['scrambled']), 'blob')).resolves.toBe(encoded);

  const [imageData] = context.putImageData.mock.calls[0];
  expect([imageData.width, imageData.height]).toEqual([8, 4]);
  expect(Array.from(imageData.data)).toEqual(Array.from(original));
  expect(revokedBeforeLoad).toBe(false);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:encrypted');
});

test('resolves an object url by default', async () => {
  await expect(decrypteImage(page, new Blob(['scrambled']))).resolves.toBe('blob:decrypted');
});

test('rejects when the scrambled image cannot be loaded', async () => {
  imageLoads = false;

  await expect(decrypteImage(page, new Blob(['not an image']), 'blob'))
    .rejects.toThrow("Couldn't load the encrypted image");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:encrypted');
});

test('rejects when the canvas cannot be encoded', async () => {
  encoded = null;

  await expect(decrypteImage(page, new Blob(['scrambled']), 'blob'))
    .rejects.toThrow("Couldn't encode the decrypted image");
});

test('rejects when painting the image throws', async () => {
  context.drawImage.mockImplementation(() => {
    throw new Error('tainted canvas');
  });

  await expect(decrypteImage(page, new Blob(['scrambled']), 'blob')).rejects.toThrow('tainted canvas');
});

test('pages decrypting at once each get their own canvas', async () => {
  await Promise.all([decrypteImage(page, new Blob(['a']), 'blob'), decrypteImage(page, new Blob(['b']), 'blob')]);

  const canvases = HTMLCanvasElement.prototype.getContext.mock.contexts;
  expect(canvases).toHaveLength(2);
  expect(canvases[0]).not.toBe(canvases[1]);
});
