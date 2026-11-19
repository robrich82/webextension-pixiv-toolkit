import { gifDelays, joinGif } from './gifFrame';

/** The most workers encoding at once; each holds about 20MB while it encodes a 1080p frame. */
const MAX_WORKERS = 4;

/**
 * Every frame has its own palette, so frames encode in parallel, leaving a core for the page.
 * @param {number} frames
 * @param {number} [cores]
 * @returns {number}
 */
export function workerCount(frames, cores = globalThis.navigator?.hardwareConcurrency) {
  return Math.max(1, Math.min(MAX_WORKERS, (cores || 2) - 1, frames));
}

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
export function encodeGif({ frames, onProgress, signal, createWorker = createGifWorker }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    if (!frames.length) {
      reject(new Error('The ugoira has no frames to encode'));
      return;
    }

    const delays = gifDelays(frames.map(frame => frame.delay));
    const chunks = new Array(frames.length);
    const workers = [];
    let next = 0;
    let encoded = 0;
    let settled = false;

    const cleanUp = () => {
      settled = true;
      workers.forEach(worker => worker.terminate());
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = error => {
      if (!settled) {
        cleanUp();
        reject(error);
      }
    };
    // A join that throws goes to fail() through onmessage's catch.
    const succeed = () => {
      const data = joinGif(chunks);

      cleanUp();
      resolve({ data, mimeType: 'image/gif', extension: 'gif' });
    };
    const onAbort = () => fail(signal.reason);
    const feed = worker => {
      if (next < frames.length) {
        const index = next++;

        worker.postMessage({ index, image: frames[index].image, delay: delays[index], first: index === 0 });
      }
    };
    const onMessage = (worker, data) => {
      if (data.error !== undefined) {
        fail(new Error(`Could not encode GIF frame ${data.index + 1}: ${data.error}`));
        return;
      }

      chunks[data.index] = data.chunk;
      encoded++;
      onProgress?.(encoded / frames.length);

      // onProgress may have aborted.
      if (settled) {
        return;
      }

      if (encoded === frames.length) {
        succeed();
        return;
      }

      feed(worker);
    };

    const count = workerCount(frames.length);

    signal?.addEventListener('abort', onAbort);

    try {
      for (let i = 0; i < count && !settled; i++) {
        const worker = createWorker();

        workers.push(worker);
        worker.onmessage = ({ data }) => {
          if (settled) {
            return;
          }

          try {
            onMessage(worker, data);
          } catch (error) {
            fail(error);
          }
        };
        worker.onmessageerror = () => fail(new Error('The GIF encoder sent a message that could not be read'));
        worker.onerror = event => {
          event.preventDefault?.();
          const where = event.filename ? ` (${event.filename}:${event.lineno})` : '';
          const what = event.message || (where ? 'an unknown error' : 'its worker did not load');

          fail(new Error(`The GIF encoder failed: ${what}${where}`));
        };
        feed(worker);
      }
    } catch (error) {
      fail(error);
    }
  });
}
