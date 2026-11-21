import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { MIN_IMAGE_DELAY, frameDelay } from './delay';

/** A GIF frame's delay is a 16-bit count of 10ms. */
const MAX_DELAY = 655350;

/** gifenc's most precise colour bins without alpha: named 5-6-5, they pack 5-5-5 (gifenc#20). */
const COLOR_FORMAT = 'rgb565';

/** A pixel less opaque than this is transparent, as gifenc's oneBitAlpha has it; a GIF has no partial alpha. */
const MIN_OPAQUE_ALPHA = 128;

/** Restore to background: the next frame starts from a clear canvas, not this one, so its transparent pixels show through. */
const DISPOSE_TO_BACKGROUND = 2;

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
 * Picks out the pixels opaque enough to keep.
 * @param {Uint8Array|Uint8ClampedArray} rgba
 * @returns {Uint8Array|null} RGBA of only the opaque pixels, or null when every pixel is
 */
function opaquePixels(rgba) {
  let count = 0;

  for (let i = 3; i < rgba.length; i += 4) {
    count += rgba[i] >= MIN_OPAQUE_ALPHA;
  }

  if (count === rgba.length / 4) {
    return null;
  }

  const opaque = new Uint8Array(count * 4);

  for (let i = 0, at = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] >= MIN_OPAQUE_ALPHA) {
      opaque.set(rgba.subarray(i, i + 4), at);
      at += 4;
    }
  }

  return opaque;
}

/**
 * One frame of a GIF, quantised to its own 256 colours. A frame with transparent pixels gives them
 * a palette entry of their own and quantises the rest to 255. The first frame also writes the GIF's
 * header, screen size and loop-forever extension, so frames encode independently and joinGif()
 * puts them together.
 * @param {Uint8Array|Uint8ClampedArray} rgba RGBA pixels, not premultiplied, from the start of their buffer;
 *   alpha under 128 is transparent and the rest opaque
 * @param {number} width
 * @param {number} height
 * @param {{ delay: number, first: boolean }} options
 * @returns {Uint8Array}
 */
export function encodeGifFrame(rgba, width, height, { delay, first }) {
  const encoder = GIFEncoder({ auto: false });
  const opaque = opaquePixels(rgba);
  // rgb565 over the opaque pixels alone keeps their colours finer than gifenc's rgba4444 would.
  const palette = opaque?.length === 0 ? [] : quantize(opaque ?? rgba, opaque ? 255 : 256, { format: COLOR_FORMAT });
  const index = palette.length ? applyPalette(rgba, palette, COLOR_FORMAT) : new Uint8Array(width * height);
  const transparentIndex = opaque ? palette.push([0, 0, 0]) - 1 : 0;

  if (opaque) {
    for (let i = 0; i < index.length; i++) {
      if (rgba[i * 4 + 3] < MIN_OPAQUE_ALPHA) {
        index[i] = transparentIndex;
      }
    }
  }

  if (first) {
    encoder.writeHeader();
  }

  encoder.writeFrame(index, width, height, {
    palette,
    delay: gifDelay(delay),
    first,
    repeat: 0,
    transparent: Boolean(opaque),
    transparentIndex,
    // Every frame, opaque ones too: the frame after an opaque one may have transparent pixels.
    dispose: DISPOSE_TO_BACKGROUND
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
