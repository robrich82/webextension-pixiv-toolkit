import { MIN_IMAGE_DELAY, frameDelay } from './delay';
import { SIGNATURE } from './png';

/** fcTL's dispose op: leave the frame where it is for the next one to draw over. */
const DISPOSE_NONE = 0;
/** fcTL's blend op: the frame replaces its area, alpha and all. */
const BLEND_SOURCE = 0;

const MAX_UINT16 = 0xffff;

/**
 * @param {*} delay A frame's delay in ms
 * @returns {[number, number]} The delay as fcTL's 16-bit numerator and denominator in seconds:
 *   ms while they fit, then coarser, up to 65535s
 */
export function apngDelay(delay) {
  const ms = Math.max(frameDelay(delay), MIN_IMAGE_DELAY);

  for (const denominator of [1000, 100, 10, 1]) {
    const numerator = Math.round(ms * denominator / 1000);

    if (numerator <= MAX_UINT16) {
      return [numerator, denominator];
    }
  }

  return [MAX_UINT16, 1];
}

/**
 * @param {Uint8ClampedArray|Uint8Array} pixels RGBA, the whole frame
 * @param {Uint8ClampedArray|Uint8Array} previous RGBA, the whole frame before it
 * @param {number} width
 * @param {number} height
 * @returns {{ x: number, y: number, width: number, height: number }} The smallest rectangle
 *   holding every pixel that changed; a frame that didn't change gets its top-left pixel
 */
export function changedArea(pixels, previous, width, height) {
  const now = new Uint32Array(pixels.buffer, pixels.byteOffset, width * height);
  const before = new Uint32Array(previous.buffer, previous.byteOffset, width * height);
  let top = -1;
  let bottom = -1;
  let left = width;
  let right = -1;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let first = 0;

    while (first < width && now[row + first] === before[row + first]) {
      first++;
    }

    if (first === width) {
      continue;
    }

    let last = width - 1;

    while (now[row + last] === before[row + last]) {
      last--;
    }

    if (top < 0) {
      top = y;
    }

    bottom = y;
    left = Math.min(left, first);
    right = Math.max(right, last);
  }

  return top < 0 ?
    { x: 0, y: 0, width: 1, height: 1 } :
    { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

const paeth = (a, b, c) => {
  const pa = Math.abs(b - c);
  const pb = Math.abs(a - c);
  const pc = Math.abs(a + b - 2 * c);

  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** A filtered byte's distance from 0 as a signed byte, which libpng's filter heuristic sums. */
const cost = byte => {
  const unsigned = byte & 0xff;

  return unsigned < 128 ? unsigned : 256 - unsigned;
};

/**
 * PNG's five filters, picking each row's by the smallest sum of its bytes as signed bytes, as
 * libpng does.
 * @param {Uint8Array} row Unfiltered
 * @param {Uint8Array} above The unfiltered row above, all 0 for the first row
 * @param {number} bpp Bytes per pixel
 * @returns {number} The filter type
 */
function chooseFilter(row, above, bpp) {
  let none = 0, sub = 0, up = 0, average = 0, path = 0;

  for (let i = 0; i < row.length; i++) {
    const value = row[i];
    const a = i < bpp ? 0 : row[i - bpp];
    const b = above[i];
    const c = i < bpp ? 0 : above[i - bpp];

    none += cost(value);
    sub += cost(value - a);
    up += cost(value - b);
    average += cost(value - ((a + b) >> 1));
    path += cost(value - paeth(a, b, c));
  }

  const sums = [none, sub, up, average, path];

  return sums.indexOf(Math.min(...sums));
}

/**
 * @param {Uint8Array} row
 * @param {Uint8Array} above
 * @param {number} bpp
 * @param {number} filter
 * @param {Uint8Array} out Written from `at`
 * @param {number} at
 */
function filterRow(row, above, bpp, filter, out, at) {
  for (let i = 0; i < row.length; i++) {
    const a = i < bpp ? 0 : row[i - bpp];
    const b = above[i];
    const c = i < bpp ? 0 : above[i - bpp];

    out[at + i] = row[i] - predict(filter, a, b, c);
  }
}

/**
 * @param {number} filter
 * @param {number} a The byte a pixel to the left
 * @param {number} b The byte above
 * @param {number} c The byte above `a`
 * @returns {number}
 */
function predict(filter, a, b, c) {
  switch (filter) {
    case 1: return a;
    case 2: return b;
    case 3: return (a + b) >> 1;
    case 4: return paeth(a, b, c);
    default: return 0;
  }
}

/**
 * The area's rows as PNG image data before compression: each row its filter type, then its
 * filtered bytes.
 * @param {Uint8ClampedArray|Uint8Array} pixels RGBA, the whole frame
 * @param {number} frameWidth
 * @param {{ x: number, y: number, width: number, height: number }} area
 * @param {boolean} alpha Keep alpha (8-bit RGBA), or drop it (8-bit RGB)
 * @returns {Uint8Array}
 */
export function filterRows(pixels, frameWidth, { x, y, width, height }, alpha) {
  const bpp = alpha ? 4 : 3;
  const length = width * bpp;
  const out = new Uint8Array((length + 1) * height);
  let above = new Uint8Array(length);
  let row = new Uint8Array(length);

  for (let line = 0; line < height; line++) {
    const start = ((y + line) * frameWidth + x) * 4;

    if (alpha) {
      row.set(pixels.subarray(start, start + length));
    } else {
      for (let i = 0, from = start; i < length; i += 3, from += 4) {
        row[i] = pixels[from];
        row[i + 1] = pixels[from + 1];
        row[i + 2] = pixels[from + 2];
      }
    }

    const filter = chooseFilter(row, above, bpp);
    const at = line * (length + 1);

    out[at] = filter;
    filterRow(row, above, bpp, filter, out, at + 1);
    [above, row] = [row, above];
  }

  return out;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>} The bytes as a zlib stream, which is what PNG image data is
 */
async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));

  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * One frame of an APNG: the area that changed since the previous frame (the whole frame for the
 * first), filtered and compressed.
 * @param {object} options
 * @param {Uint8ClampedArray|Uint8Array} options.pixels RGBA
 * @param {Uint8ClampedArray|Uint8Array|null} options.previous RGBA of the frame before, one size with this one
 * @param {number} options.width
 * @param {number} options.height
 * @param {boolean} options.alpha
 * @returns {Promise<{ x: number, y: number, width: number, height: number, data: Uint8Array }>}
 */
export async function encodeApngFrame({ pixels, previous, width, height, alpha }) {
  const area = previous ? changedArea(pixels, previous, width, height) : { x: 0, y: 0, width, height };

  return { ...area, data: await deflate(filterRows(pixels, width, area, alpha)) };
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;

  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }

  return c >>> 0;
});

/**
 * @param {Uint8Array} bytes
 * @returns {number} PNG's CRC-32
 */
export function crc32(bytes) {
  let crc = 0xffffffff;

  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {number} length Of the chunk's data
 * @param {(view: DataView, bytes: Uint8Array) => void} write Fills the data, which starts at 0
 * @returns {Uint8Array} The whole chunk: length, type, data and CRC
 */
function chunk(type, length, write) {
  const bytes = new Uint8Array(12 + length);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, length);
  for (let i = 0; i < 4; i++) {
    bytes[4 + i] = type.charCodeAt(i);
  }

  write(new DataView(bytes.buffer, 8, length), bytes.subarray(8, 8 + length));
  view.setUint32(8 + length, crc32(bytes.subarray(4, 8 + length)));

  return bytes;
}

/**
 * Puts encodeApngFrame()'s frames together as an APNG that loops forever.
 * @param {object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {boolean} options.alpha As every frame was encoded
 * @param {{ type: string, data: Uint8Array }[]} [options.colorChunks] cHRM, gAMA, iCCP or sRGB, as every frame had them
 * @param {{ x: number, y: number, width: number, height: number, data: Uint8Array, delay: number }[]} options.frames
 *   In order, the first one the whole image; `delay` in ms
 * @returns {Uint8Array}
 */
export function muxApng({ width, height, alpha, colorChunks = [], frames }) {
  const chunks = [
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', 13, view => {
      view.setUint32(0, width);
      view.setUint32(4, height);
      view.setUint8(8, 8); // bit depth
      view.setUint8(9, alpha ? 6 : 2); // RGBA or RGB; compression, filter and interlace stay 0
    }),
    ...colorChunks.map(({ type, data }) => chunk(type, data.length, (_, bytes) => bytes.set(data))),
    chunk('acTL', 8, view => {
      view.setUint32(0, frames.length);
      view.setUint32(4, 0); // plays forever
    })
  ];
  let sequence = 0;

  frames.forEach((frame, index) => {
    const [numerator, denominator] = apngDelay(frame.delay);

    chunks.push(chunk('fcTL', 26, view => {
      view.setUint32(0, sequence++);
      view.setUint32(4, frame.width);
      view.setUint32(8, frame.height);
      view.setUint32(12, frame.x);
      view.setUint32(16, frame.y);
      view.setUint16(20, numerator);
      view.setUint16(22, denominator);
      view.setUint8(24, DISPOSE_NONE);
      view.setUint8(25, BLEND_SOURCE);
    }));

    // The first frame is the image a viewer without APNG shows.
    chunks.push(index === 0 ?
      chunk('IDAT', frame.data.length, (_, bytes) => bytes.set(frame.data)) :
      chunk('fdAT', 4 + frame.data.length, (view, bytes) => {
        view.setUint32(0, sequence++);
        bytes.set(frame.data, 4);
      }));
  });

  chunks.push(chunk('IEND', 0, () => {}));

  const apng = new Uint8Array(chunks.reduce((length, part) => length + part.length, 0));
  let offset = 0;

  for (const part of chunks) {
    apng.set(part, offset);
    offset += part.length;
  }

  return apng;
}
