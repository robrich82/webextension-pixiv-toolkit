// @vitest-environment jsdom
/**
 * decrypteImage paints the scrambled page on a canvas, unscrambles the pixels
 * and reads the canvas back. jsdom has no canvas or image decoding, so both are
 * stubbed; ImageDecrypte itself is covered in ImageDecrypte.spec.js.
 */
import { decrypteImage } from '../src/modules/Parser/PixivComic/ImageDecrypte';

const page = { width: 4, height: 2, gridsize: 2, key: 'aaaaaaaaaaaaaaaa' };

let imageLoads;
let encoded;
let context;

class FakeImage {
  set src(url) {
    this.url = url;
    setTimeout(() => (imageLoads ? this.onload() : this.onerror()));
  }
}

class FakeImageData {
  constructor(data, width, height) {
    Object.assign(this, { data, width, height });
  }
}

beforeEach(() => {
  imageLoads = true;
  encoded = new Blob(['decrypted'], { type: 'image/png' });
  context = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(page.width * page.height * 4) })),
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
  document.body.replaceChildren();
});

test('paints the page, puts back the unscrambled pixels and resolves the canvas as a blob', async () => {
  await expect(decrypteImage(page, new Blob(['scrambled']), 'blob')).resolves.toBe(encoded);

  expect(context.drawImage).toHaveBeenCalledTimes(1);
  const [imageData] = context.putImageData.mock.calls[0];
  expect([imageData.width, imageData.height]).toEqual([4, 2]);
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
