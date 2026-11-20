import { encodeApngFrame } from './apngFrame';
import { decodePng, isPng } from './png';

/**
 * @param {Blob} image
 * @param {'none'|'default'} colorSpaceConversion
 */
async function decodeInBrowser(image, colorSpaceConversion) {
  const bitmap = await createImageBitmap(image, { colorSpaceConversion });
  const { width, height } = bitmap;
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });

  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  return { pixels: context.getImageData(0, 0, width, height).data, width, height };
}

/**
 * With `exact`, PNGs are decoded by png.js with their colours as stored, for the APNG to carry their
 * colour chunks; a canvas would premultiply semi-transparent pixels. A PNG png.js won't take goes
 * through the browser with its colours as stored. Everything else, JPEGs included, goes through the
 * browser converted to sRGB.
 * @param {Blob} image
 * @param {boolean} exact
 * @param {number} [frame] The 1-based frame number to warn with when png.js refuses it; none, no warning
 * @returns {Promise<{ pixels: Uint8ClampedArray|Uint8Array, width: number, height: number }>} Its RGBA pixels
 */
async function decode(image, exact, frame) {
  if (exact && isPng(new Uint8Array(await image.slice(0, 8).arrayBuffer()))) {
    try {
      return await decodePng(new Uint8Array(await image.arrayBuffer()));
    } catch (pngError) {
      if (frame) {
        console.warn('png.js could not decode APNG frame', frame, 'so the browser decodes it', pngError);
      }

      return decodeInBrowser(image, 'none').catch(error => {
        throw new Error(`${pngError.message}; the browser could not decode it either (${error.name}: ${error.message})`,
          { cause: error });
      });
    }
  }

  return decodeInBrowser(image, 'default');
}

/**
 * @param {{ index: number, image: Blob, previous: Blob|null, alpha: boolean, exact: boolean }} frame
 * @returns {Promise<{ x: number, y: number, width: number, height: number, frameWidth: number, frameHeight: number, data: Uint8Array }>}
 */
async function encode({ index, image, previous, alpha, exact }) {
  const { pixels, width, height } = await decode(image, exact, index + 1);
  // Decoding the previous frame here too keeps every frame independent of the other workers. If it
  // won't decode, this frame is stored whole, and the previous frame's own job warns about png.js
  // and reports the error.
  const before = previous && await decode(previous, exact).catch(error => {
    console.warn('APNG frame', index + 1, 'is stored whole: the frame before it would not decode', error);
    return null;
  });
  const sameSize = before?.width === width && before?.height === height;
  const frame = await encodeApngFrame({ pixels, previous: sameSize ? before.pixels : null, width, height, alpha });

  return { ...frame, frameWidth: width, frameHeight: height };
}

/**
 * Encodes each frame it is sent, { index, image, previous, alpha, exact }, into the APNG frame apng.js
 * muxes, and answers { index, result } or { index, error }. Whatever it can't answer goes to
 * reportError(), which reaches the page's onerror; a rejection here would not.
 */
self.onmessage = ({ data }) => encode(data)
  .then(result => self.postMessage({ index: data.index, result }, [result.data.buffer]))
  .catch(error => {
    console.error('Could not encode APNG frame', data ? data.index + 1 : data, error);
    self.postMessage({ index: data?.index, error: String(error) });
  })
  .catch(error => reportError(error));

self.onmessageerror = () => reportError(new Error('The APNG worker could not read a frame'));
