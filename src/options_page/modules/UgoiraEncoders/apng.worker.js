import { encodeApngFrame } from './apngFrame';
import { decodePng, isPng } from './png';

/**
 * PNGs are decoded exactly by png.js; a canvas would premultiply their semi-transparent pixels.
 * JPEGs have no alpha, so the browser decodes them.
 * @param {Blob} image
 * @returns {Promise<{ pixels: Uint8ClampedArray|Uint8Array, width: number, height: number }>} Its RGBA pixels
 */
async function decode(image) {
  const bytes = new Uint8Array(await image.slice(0, 8).arrayBuffer());

  if (isPng(bytes)) {
    return decodePng(new Uint8Array(await image.arrayBuffer()));
  }

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
  // Decoding the previous frame here too keeps every frame independent of the other workers. If it
  // won't decode, this frame is stored whole and the previous frame's own job reports the error.
  const before = previous && await decode(previous).catch(() => null);
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
