import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { MIN_IMAGE_DELAY, frameDelay } from './delay';

/** A GIF frame's delay is a 16-bit count of 10ms. */
const MAX_DELAY = 655350;

/** gifenc's most precise colour bins without alpha: named 5-6-5, they pack 5-5-5 (gifenc#20). */
const COLOR_FORMAT = 'rgb565';

const TRAILER = 0x3b;

/**
 * @param {*} delay A frame's delay in ms
 * @returns {number} The delay in ms the GIF gives the frame, which gifenc rounds to 10ms
 */
export function gifDelay(delay) {
  return Math.min(Math.max(frameDelay(delay), MIN_IMAGE_DELAY), MAX_DELAY);
}

/**
 * Rounds each frame's start, not its delay, to the GIF's 10ms, so 30fps frames of 33 and 34ms
 * don't all play for 30ms and run 10% fast.
 * @param {*[]} delays Every frame's delay in ms, in order
 * @returns {number[]} The delays in ms, each a multiple of 10 from 20 to 655350
 */
export function gifDelays(delays) {
  let start = 0;

  return delays.map(delay => {
    const end = start + gifDelay(delay);
    // Float error in a running start of fractional delays can round one past the cap.
    const rounded = Math.min((Math.round(end / 10) - Math.round(start / 10)) * 10, MAX_DELAY);

    start = end;
    return rounded;
  });
}

/**
 * One frame of a GIF, quantised to its own 256 colours. The first frame also writes the GIF's
 * header, screen size and loop-forever extension, so frames encode independently and joinGif()
 * puts them together.
 * @param {Uint8Array|Uint8ClampedArray} rgba RGBA pixels, alpha ignored, from the start of their buffer
 * @param {number} width
 * @param {number} height
 * @param {{ delay: number, first: boolean }} options
 * @returns {Uint8Array}
 */
export function encodeGifFrame(rgba, width, height, { delay, first }) {
  const encoder = GIFEncoder({ auto: false });
  const palette = quantize(rgba, 256, { format: COLOR_FORMAT });

  if (first) {
    encoder.writeHeader();
  }

  encoder.writeFrame(applyPalette(rgba, palette, COLOR_FORMAT), width, height, {
    palette, delay: gifDelay(delay), first, repeat: 0
  });

  return encoder.bytes();
}

/**
 * @param {Uint8Array[]} chunks Every frame's encodeGifFrame(), in order, the first one first
 * @returns {Uint8Array} The GIF
 */
export function joinGif(chunks) {
  const gif = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0) + 1);
  let offset = 0;

  for (const chunk of chunks) {
    gif.set(chunk, offset);
    offset += chunk.length;
  }

  gif[offset] = TRAILER;

  return gif;
}
