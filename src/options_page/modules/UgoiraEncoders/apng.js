import { muxApng } from './apngFrame';
import { encodeInWorkers } from './pool';
import { readPngHeader } from './png';

const createApngWorker = () => new Worker(new URL('./apng.worker.js', import.meta.url));

const sameBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);

const sameChunks = (a, b) => a.length === b.length && a.every(({ type, data }, i) => type === b[i].type && sameBytes(data, b[i].data));

/**
 * A frame's colour chunks, none when they say sRGB: sRGB overrides gAMA and cHRM, and an untagged
 * frame is read as sRGB anyway. iCCP and cICP override sRGB, so a frame with either keeps them all.
 */
function effectiveColorChunks(colorChunks) {
  const types = colorChunks.map(({ type }) => type);

  return types.includes('sRGB') && !types.includes('iCCP') && !types.includes('cICP') ? [] : colorChunks;
}

/**
 * Why the APNG can't hold the frames' colours as stored, under their colour chunks, if it can't:
 * every frame needs the same ones (a JPEG none), none may have cICP (left to the browser to
 * convert), and no grey frame may have iCCP, whose grey profile an RGB APNG can't hold.
 * @param {{ colorType?: number, colorChunks: { type: string, data: Uint8Array }[] }[]} headers
 * @returns {string|null} The reason, naming the first frame that breaks the rule; null when it can
 */
function colorMismatch(headers) {
  const chunks = headers.map(({ colorChunks }) => effectiveColorChunks(colorChunks));

  for (const [i, { colorType }] of headers.entries()) {
    const types = chunks[i].map(({ type }) => type);

    if (types.includes('cICP')) {
      return `frame ${i + 1} has a cICP chunk`;
    }
    if (types.includes('iCCP') && (colorType === 0 || colorType === 4)) {
      return `frame ${i + 1} is grey with an ICC profile`;
    }
    if (!sameChunks(chunks[i], chunks[0])) {
      return `frame ${i + 1}'s colour chunks differ from frame 1's`;
    }
  }

  return null;
}

/**
 * Encodes the frames as a looping APNG, each frame after the first holding only the area that
 * changed, in a pool of workers. It has alpha when a frame does (a PNG with an alpha channel or
 * tRNS). When the frames' colour chunks can go in the APNG, PNG frames keep their colours as stored
 * and the APNG carries the chunks; otherwise the browser converts every frame to sRGB.
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
  const mismatch = headers.length > 0 ? colorMismatch(headers) : 'there are no frames';
  const exact = !mismatch;
  const colorChunks = exact ? effectiveColorChunks(headers[0].colorChunks) : [];

  if (mismatch && headers.length) {
    console.info(`APNG: converting every frame to sRGB, because ${mismatch}`);
  }
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
