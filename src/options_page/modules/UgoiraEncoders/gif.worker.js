import { encodeGifFrame } from './gifFrame';

/**
 * @param {{ image: Blob, delay: number, first: boolean }} frame
 * @returns {Promise<Uint8Array>} The frame's GIF chunk
 */
async function encode({ image, delay, first }) {
  const bitmap = await createImageBitmap(image);
  const { width, height } = bitmap;
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });

  // Not drawn over black, as the videos are: encodeGifFrame() keeps transparency. The canvas premultiplies,
  // which moves a colour by at most 1 at the alpha of 128 and up that the GIF keeps opaque.
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  return encodeGifFrame(context.getImageData(0, 0, width, height).data, width, height, { delay, first });
}

/**
 * Encodes each frame it is sent, { index, image, delay, first }, into the GIF chunk gif.js joins,
 * and answers { index, result: chunk } or { index, error }. Whatever it can't answer goes to reportError(),
 * which reaches the page's onerror; a rejection here would not.
 */
self.onmessage = ({ data }) => encode(data)
  .then(chunk => self.postMessage({ index: data.index, result: chunk }, [chunk.buffer]))
  .catch(error => {
    console.error('Could not encode GIF frame', data?.index, error);
    // "EncodingError: The source image cannot be decoded."
    self.postMessage({ index: data?.index, error: String(error) });
  })
  .catch(error => reportError(error));

self.onmessageerror = () => reportError(new Error('The GIF worker could not read a frame'));
