import { muxApng } from './apngFrame';
import { encodeInWorkers } from './pool';

const createApngWorker = () => new Worker(new URL('./apng.worker.js', import.meta.url));

/**
 * Encodes the frames as a looping APNG, each frame after the first holding only the area that
 * changed, in a pool of workers. JPEG frames make an RGB APNG and PNG frames an RGBA one.
 * @param {object} options
 * @param {{ image: Blob, delay: number }[]} options.frames JPEG or PNG frames, all one size and type
 * @param {(progress: number) => void} [options.onProgress] With the share of frames encoded
 * @param {AbortSignal} [options.signal] Cancels the encoding, which then rejects
 * @param {() => Worker} [options.createWorker] A worker running apng.worker.js
 * @returns {Promise<{ data: Uint8Array, mimeType: string, extension: string }>}
 */
export async function encodeApng({ frames, onProgress, signal, createWorker = createApngWorker }) {
  const alpha = frames[0]?.image.type !== 'image/jpeg';
  const encoded = await encodeInWorkers({
    name: 'APNG',
    count: frames.length,
    message: index => ({ index, image: frames[index].image, previous: frames[index - 1]?.image ?? null, alpha }),
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
    data: muxApng({ width, height, alpha, frames: encoded.map((frame, i) => ({ ...frame, delay: frames[i].delay })) }),
    mimeType: 'image/apng',
    extension: 'apng'
  };
}
