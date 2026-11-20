import { encodeApngFrame } from './apngFrame';

/**
 * @param {Blob} image
 * @returns {Promise<{ pixels: Uint8ClampedArray, width: number, height: number }>} Its RGBA pixels
 */
async function decode(image) {
  const bitmap = await createImageBitmap(image);
  const { width, height } = bitmap;
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });

  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  return { pixels: context.getImageData(0, 0, width, height).data, width, height };
}

/**
 * @param {{ image: Blob, previous: Blob|null, alpha: boolean }} frame
 * @returns {Promise<{ x: number, y: number, width: number, height: number, frameWidth: number, frameHeight: number, data: Uint8Array }>}
 */
async function encode({ image, previous, alpha }) {
  const { pixels, width, height } = await decode(image);
  // Decoding the frame before again keeps every frame independent of the other workers.
  const before = previous && await decode(previous);
  const sameSize = before?.width === width && before?.height === height;
  const frame = await encodeApngFrame({ pixels, previous: sameSize ? before.pixels : null, width, height, alpha });

  return { ...frame, frameWidth: width, frameHeight: height };
}

/**
 * Encodes each frame it is sent, { index, image, previous, alpha }, into the APNG frame apng.js
 * muxes, and answers { index, result } or { index, error }. Whatever it can't answer goes to
 * reportError(), which reaches the page's onerror; a rejection here would not.
 */
self.onmessage = ({ data }) => encode(data)
  .then(result => self.postMessage({ index: data.index, result }, [result.data.buffer]))
  .catch(error => {
    console.error('Could not encode APNG frame', data?.index, error);
    self.postMessage({ index: data?.index, error: String(error) });
  })
  .catch(error => reportError(error));

self.onmessageerror = () => reportError(new Error('The APNG worker could not read a frame'));
