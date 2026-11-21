import { gifDelays, joinGif } from './gifFrame';
import { encodeInWorkers } from './pool';

const createGifWorker = () => new Worker(new URL('./gif.worker.js', import.meta.url));

/**
 * Encodes the frames as a looping GIF, each frame quantised to its own 256 colours and shown for
 * its own delay, in a pool of workers.
 * @param {object} options
 * @param {{ image: Blob, delay: number }[]} options.frames JPEG or PNG frames, all one size
 * @param {(progress: number) => void} [options.onProgress] With the share of frames encoded
 * @param {AbortSignal} [options.signal] Cancels the encoding, which then rejects
 * @param {() => Worker} [options.createWorker] A worker running gif.worker.js
 * @returns {Promise<{ data: Uint8Array, mimeType: string, extension: string }>}
 */
export async function encodeGif({ frames, onProgress, signal, createWorker = createGifWorker }) {
  const delays = gifDelays(frames.map(frame => frame.delay));
  const chunks = await encodeInWorkers({
    name: 'GIF',
    count: frames.length,
    message: index => ({ index, image: frames[index].image, delay: delays[index], first: index === 0 }),
    createWorker,
    onProgress,
    signal
  });

  return { data: joinGif(chunks), mimeType: 'image/gif', extension: 'gif' };
}
