import { muxApng } from './apngFrame';
import { encodeInWorkers } from './pool';
import { readPngHeader } from './png';

const createApngWorker = () => new Worker(new URL('./apng.worker.js', import.meta.url));

const sameBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * Whether the APNG can hold the frames' colours as stored, under their colour chunks: every frame
 * has the same ones (a JPEG none), none has cICP (left to the browser to convert), and no grey frame
 * has iCCP, whose grey profile an RGB APNG can't hold.
 * @param {{ colorType?: number, colorChunks: { type: string, data: Uint8Array }[] }[]} headers
 * @returns {boolean}
 */
function keepsColors(headers) {
  const [first] = headers;

  return headers.every(({ colorType, colorChunks }) =>
    colorChunks.length === first.colorChunks.length &&
    colorChunks.every(({ type, data }, i) => type === first.colorChunks[i].type && sameBytes(data, first.colorChunks[i].data)) &&
    colorChunks.every(({ type }) => type !== 'cICP' && !(type === 'iCCP' && (colorType === 0 || colorType === 4))));
}

/**
 * Encodes the frames as a looping APNG, each frame after the first holding only the area that
 * changed, in a pool of workers. It has alpha when a frame does (a PNG with an alpha channel or
 * tRNS). When the frames' colour chunks can go in the APNG, PNG frames keep their pixels exactly and
 * the APNG carries the chunks; otherwise the browser converts every frame to sRGB.
 * @param {object} options
 * @param {{ image: Blob, delay: number }[]} options.frames JPEG or PNG frames, all one size
 * @param {(progress: number) => void} [options.onProgress] With the share of frames encoded
 * @param {AbortSignal} [options.signal] Cancels the encoding, which then rejects
 * @param {() => Worker} [options.createWorker] A worker running apng.worker.js
 * @returns {Promise<{ data: Uint8Array, mimeType: string, extension: string }>}
 */
export async function encodeApng({ frames, onProgress, signal, createWorker = createApngWorker }) {
  const headers = await Promise.all(frames.map((frame, i) => readPngHeader(frame.image).catch(error => {
    throw new Error(`Could not read APNG frame ${i + 1}: ${error.message}`, { cause: error });
  })));
  const alpha = headers.some(header => header.alpha);
  const exact = headers.length > 0 && keepsColors(headers);
  const colorChunks = exact ? headers[0].colorChunks : [];
  const encoded = await encodeInWorkers({
    name: 'APNG',
    count: frames.length,
    message: index => ({ index, image: frames[index].image, previous: frames[index - 1]?.image ?? null, alpha, exact }),
    createWorker,
    onProgress,
    signal
  });
  const { frameWidth: width, frameHeight: height } = encoded[0];
  const odd = encoded.findIndex(frame => frame.frameWidth !== width || frame.frameHeight !== height);

  if (odd > -1) {
    throw new Error(`APNG frame ${odd + 1} is ${encoded[odd].frameWidth}x${encoded[odd].frameHeight}, ` +
      `not the first frame's ${width}x${height}`);
  }

  return {
    data: muxApng({ width, height, alpha, colorChunks, frames: encoded.map((frame, i) => ({ ...frame, delay: frames[i].delay })) }),
    mimeType: 'image/apng',
    extension: 'apng'
  };
}
