/** The most workers encoding at once; each holds a few decoded 1080p frames while it encodes. */
const MAX_WORKERS = 4;

/**
 * Frames encode independently, so they encode in parallel, leaving a core for the page.
 * @param {number} frames
 * @param {number} [cores]
 * @returns {number}
 */
export function workerCount(frames, cores = globalThis.navigator?.hardwareConcurrency) {
  return Math.max(1, Math.min(MAX_WORKERS, (cores || 2) - 1, frames));
}

/**
 * Encodes every frame in a pool of workers, handing each worker its next frame once it answers.
 * A worker is sent `message(index)` and answers { index, result } or { index, error }.
 * @param {object} options
 * @param {string} options.name The format, for errors
 * @param {number} options.count How many frames there are
 * @param {(index: number) => object} options.message What to send a worker for frame `index`
 * @param {() => Worker} options.createWorker
 * @param {(progress: number) => void} [options.onProgress] With the share of frames encoded
 * @param {AbortSignal} [options.signal] Cancels the encoding, which then rejects
 * @returns {Promise<any[]>} Every frame's result, in order
 */
export function encodeInWorkers({ name, count, message, createWorker, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    if (!count) {
      reject(new Error('The ugoira has no frames to encode'));
      return;
    }

    const results = new Array(count);
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
    const onAbort = () => fail(signal.reason);
    const feed = worker => {
      if (next < count) {
        worker.postMessage(message(next++));
      }
    };
    const onMessage = (worker, data) => {
      if (data.error !== undefined) {
        fail(new Error(`Could not encode ${name} frame ${data.index + 1}: ${data.error}`));
        return;
      }

      results[data.index] = data.result;
      encoded++;
      onProgress?.(encoded / count);

      // onProgress may have aborted.
      if (settled) {
        return;
      }

      if (encoded === count) {
        cleanUp();
        resolve(results);
        return;
      }

      feed(worker);
    };

    signal?.addEventListener('abort', onAbort);

    try {
      for (let i = workerCount(count); i > 0 && !settled; i--) {
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
        worker.onmessageerror = () => fail(new Error(`The ${name} encoder sent a message that could not be read`));
        worker.onerror = event => {
          event.preventDefault?.();
          const where = event.filename ? ` (${event.filename}:${event.lineno})` : '';
          const what = event.message || (where ? 'an unknown error' : 'its worker did not load');

          fail(new Error(`The ${name} encoder failed: ${what}${where}`));
        };
        feed(worker);
      }
    } catch (error) {
      fail(error);
    }
  });
}
