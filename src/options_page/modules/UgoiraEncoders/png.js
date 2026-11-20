/**
 * A PNG decoder for the APNG worker. A canvas would premultiply alpha and lose semi-transparent
 * pixels' colour, so when the APNG keeps the frames' colours, PNG frames are read here instead.
 */

import { inflateSync } from 'fflate';

export const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Colour type → samples per pixel. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Colour type → the bit depths PNG allows with it. */
const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

/** Adam7's passes: x and y of the first pixel, then the step between pixels. */
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

/** The most pixels decodePng takes on, bounding its memory; the browser decodes anything bigger. */
export const MAX_PIXELS = 4096 * 4096;

/** The chunks that say how to read the colours. */
const COLOR_CHUNKS = ['cHRM', 'gAMA', 'iCCP', 'sRGB', 'cICP'];

/**
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export const isPng = bytes => SIGNATURE.every((byte, i) => bytes[i] === byte);

const isJpeg = bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

/**
 * @param {Uint8Array} bytes A PNG
 * @param {(type: string, data: Uint8Array) => void} visit Called for each chunk in order
 * @param {(type: string) => boolean} until Whether to stop at a chunk, before reading it
 * @returns {boolean} Whether `until` stopped it
 */
function eachChunk(bytes, visit, until) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);

  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));

    if (until(type)) {
      return true;
    }

    const data = bytes.subarray(at + 8, at + 8 + length);

    if (data.length !== length) {
      throw new Error(`The PNG's ${type} chunk runs past its end`);
    }

    visit(type, data);

    if (type === 'IEND') {
      break;
    }

    at += 12 + length;
  }

  return false;
}

/**
 * Whether libpng would apply a tRNS chunk that follows a valid IHDR: one sample's worth for grey
 * or RGB, and for a palette at least one entry and no more than the palette's colours, a palette
 * longer than the bit depth can index counting only as far as it can. Never with an alpha channel.
 */
function validTransparency(ihdr, data, palette) {
  const [depth, colorType] = ihdr.subarray(8, 10);

  switch (colorType) {
    case 0: return data.length === 2;
    case 2: return data.length === 6;
    case 3: return Boolean(palette) && data.length > 0 && data.length <= Math.min(palette.length / 3, 1 << depth);
    default: return false;
  }
}

/**
 * Reads chunks as libpng does: the first IHDR, PLTE and valid tRNS count, and colour chunks only
 * before PLTE.
 * @param {Uint8Array} bytes A PNG
 * @param {(type: string, found: { idat: Uint8Array[] }) => boolean} until Whether to stop at a chunk
 * @returns The chunks that matter for decoding, and whether `until` stopped the walk
 */
function readChunks(bytes, until) {
  const found = { ihdr: undefined, palette: undefined, transparency: undefined, idat: [], colorChunks: [] };
  const stopped = eachChunk(bytes, (type, data) => {
    if (type === 'IHDR') {
      found.ihdr ??= data;
    } else if (type === 'PLTE') {
      found.palette ??= data;
    } else if (type === 'tRNS') {
      if (!found.transparency && found.ihdr?.length === 13 && validTransparency(found.ihdr, data, found.palette)) {
        found.transparency = data;
      }
    } else if (type === 'IDAT') {
      found.idat.push(data);
    } else if (COLOR_CHUNKS.includes(type) && !found.palette) {
      found.colorChunks.push({ type, data: data.slice() });
    }
  }, type => until(type, found));

  return { ...found, stopped };
}

/** @param {Uint8Array|undefined} ihdr */
function checkIhdr(ihdr) {
  if (!ihdr) {
    throw new Error('The PNG has no IHDR chunk');
  }
  if (ihdr.length !== 13) {
    throw new Error(`The PNG's IHDR chunk is ${ihdr.length} bytes, not 13`);
  }
}

/**
 * What a frame's header says, read from the start of the file only.
 * @param {Blob} image
 * @returns {Promise<{ alpha: boolean, colorType?: number, colorChunks: { type: string, data: Uint8Array }[] }>}
 *   Whether it has alpha (a PNG with colour type 4 or 6, or a valid tRNS; anything but a JPEG
 *   otherwise), and for a PNG its colour type and the colour chunks before any PLTE
 */
export async function readPngHeader(image) {
  // Everything before the image data, ICC profile and all, which can take more than one read.
  for (let size = 64 * 1024; ; size *= 4) {
    const bytes = new Uint8Array(await image.slice(0, size).arrayBuffer());

    if (!isPng(bytes)) {
      return { alpha: !isJpeg(bytes), colorChunks: [] };
    }

    try {
      return scanHeader(bytes);
    } catch (error) {
      if (size >= image.size) {
        throw error;
      }
    }
  }
}

/**
 * @param {Uint8Array} bytes The start of a PNG, through its first IDAT chunk's header
 */
function scanHeader(bytes) {
  const { ihdr, transparency, colorChunks, stopped } = readChunks(bytes, type => type === 'IDAT');

  checkIhdr(ihdr);

  if (!stopped) {
    throw new Error('The PNG has no image data');
  }

  const colorType = ihdr[9];

  return { alpha: colorType === 4 || colorType === 6 || Boolean(transparency), colorType, colorChunks };
}

/**
 * @param {Uint8Array[]} parts One zlib stream, split up as the IDAT chunks were
 * @param {number} length How many bytes the image needs; inflating stops there
 * @returns {Promise<Uint8Array>} Up to `length` bytes
 */
async function inflate(parts, length) {
  try {
    return await inflateNatively(parts, length);
  } catch (error) {
    // The browsers' DecompressionStream refuses bytes after the zlib stream, dropping output it
    // hasn't handed over yet; libpng ignores them, and so does fflate, which also skips the checksum.
    try {
      return inflateSync(concat(parts).subarray(2), { out: new Uint8Array(length) });
    } catch {
      throw new Error(`The PNG's image data won't inflate: ${error.message || error.name}`, { cause: error });
    }
  }
}

/** inflate() through the browser's DecompressionStream, which is faster than fflate. */
async function inflateNatively(parts, length) {
  const reader = new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const out = new Uint8Array(length);
  let filled = 0;

  while (filled < length) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    const take = Math.min(value.length, length - filled);

    out.set(value.subarray(0, take), filled);
    filled += take;
  }

  // Inflated bytes past what the image needs are ignored, as libpng does.
  reader.cancel().catch(() => {});

  return out.subarray(0, filled);
}

/** @param {Uint8Array[]} parts */
function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));

  parts.reduce((at, part) => (out.set(part, at), at + part.length), 0);

  return out;
}

/**
 * Undoes each row's filter.
 * @param {Uint8Array} data Rows of `1 + rowBytes` bytes, the first the filter type
 * @param {number} rows
 * @param {number} rowBytes
 * @param {number} bpp Bytes per complete pixel, at least 1
 * @param {number} at Where the rows start in `data`
 * @returns {Uint8Array} The rows without their filter bytes
 */
function unfilter(data, rows, rowBytes, bpp, at) {
  const out = new Uint8Array(rows * rowBytes);
  const left = Math.min(bpp, rowBytes);
  let prior = new Uint8Array(rowBytes);

  for (let y = 0; y < rows; y++) {
    const start = at + y * (rowBytes + 1);
    const filter = data[start];
    const from = start + 1;
    const row = y * rowBytes;

    // Bytes in the first pixel have nothing to their left; the arrays wrap sums to a byte.
    switch (filter) {
      case 0:
        out.set(data.subarray(from, from + rowBytes), row);
        break;
      case 1:
        out.set(data.subarray(from, from + left), row);
        for (let i = bpp; i < rowBytes; i++) {
          out[row + i] = data[from + i] + out[row + i - bpp];
        }
        break;
      case 2:
        for (let i = 0; i < rowBytes; i++) {
          out[row + i] = data[from + i] + prior[i];
        }
        break;
      case 3:
        for (let i = 0; i < left; i++) {
          out[row + i] = data[from + i] + (prior[i] >> 1);
        }
        for (let i = bpp; i < rowBytes; i++) {
          out[row + i] = data[from + i] + ((out[row + i - bpp] + prior[i]) >> 1);
        }
        break;
      case 4:
        for (let i = 0; i < left; i++) {
          out[row + i] = data[from + i] + prior[i];
        }
        for (let i = bpp; i < rowBytes; i++) {
          const a = out[row + i - bpp];
          const b = prior[i];
          const c = prior[i - bpp];
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);

          out[row + i] = data[from + i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        break;
      default:
        throw new Error(`The PNG has a row with an unknown filter, ${filter}`);
    }

    prior = out.subarray(row, row + rowBytes);
  }

  return out;
}

/**
 * Decodes a PNG to 8-bit RGBA without touching its colours: no premultiplying and no colour
 * management. 16-bit samples round to 8 bits. Chunks after the image data are not read.
 * @param {Uint8Array} bytes
 * @returns {Promise<{ pixels: Uint8Array, width: number, height: number }>}
 */
export async function decodePng(bytes) {
  if (!isPng(bytes)) {
    throw new Error('Not a PNG');
  }

  const { ihdr, palette, transparency, idat } = readChunks(bytes, (type, found) => found.idat.length > 0 && type !== 'IDAT');

  checkIhdr(ihdr);

  const header = new DataView(ihdr.buffer, ihdr.byteOffset, 13);
  const width = header.getUint32(0);
  const height = header.getUint32(4);
  const [depth, colorType, compression, filterMethod, interlace] = ihdr.subarray(8, 13);

  if (!width || !height || !DEPTHS[colorType]?.includes(depth) || compression || filterMethod || interlace > 1) {
    throw new Error(`The PNG's IHDR is not one PNG allows: ${width}x${height}, depth ${depth}, ` +
      `colour type ${colorType}, compression ${compression}, filter ${filterMethod}, interlace ${interlace}`);
  }
  if (width * height > MAX_PIXELS) {
    throw new Error(`The PNG is ${width}x${height}, more than the ${MAX_PIXELS} pixels decoded here`);
  }
  if (colorType === 3 && !palette) {
    throw new Error('The PNG has a palette colour type but no palette');
  }
  if (!idat.length) {
    throw new Error('The PNG has no image data');
  }

  const bitsPerPixel = CHANNELS[colorType] * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const passes = (interlace ? ADAM7 : [[0, 0, 1, 1]]).map(([x0, y0, dx, dy]) => {
    const passWidth = Math.max(0, Math.ceil((width - x0) / dx));
    const passHeight = Math.max(0, Math.ceil((height - y0) / dy));

    return { x0, y0, dx, dy, passWidth, passHeight, rowBytes: Math.ceil(passWidth * bitsPerPixel / 8) };
  }).filter(pass => pass.passWidth && pass.passHeight);
  const length = passes.reduce((sum, pass) => sum + pass.passHeight * (pass.rowBytes + 1), 0);
  const data = await inflate(idat, length);

  if (data.length < length) {
    throw new Error('The PNG\'s image data is too short');
  }

  const pixels = new Uint8Array(width * height * 4);
  const writePixel = pixelWriter({ colorType, depth, palette, transparency, pixels });
  let at = 0;

  for (const { x0, y0, dx, dy, passWidth, passHeight, rowBytes } of passes) {
    const rows = unfilter(data, passHeight, rowBytes, bpp, at);

    for (let y = 0; y < passHeight; y++) {
      const row = y * rowBytes;
      const to = ((y0 + y * dy) * width + x0) * 4;

      // Fast paths for whole rows of 8-bit RGBA, and of RGB without tRNS; the rest go pixel by pixel.
      if (dx === 1 && depth === 8 && colorType === 6) {
        pixels.set(rows.subarray(row, row + rowBytes), to);
      } else if (dx === 1 && depth === 8 && colorType === 2 && !transparency) {
        for (let from = row, end = row + rowBytes, i = to; from < end; from += 3, i += 4) {
          pixels[i] = rows[from];
          pixels[i + 1] = rows[from + 1];
          pixels[i + 2] = rows[from + 2];
          pixels[i + 3] = 255;
        }
      } else {
        for (let x = 0; x < passWidth; x++) {
          writePixel(rows, row, x, to + x * dx * 4);
        }
      }
    }

    at += passHeight * (rowBytes + 1);
  }

  return { pixels, width, height };
}

/** @returns {(rows: Uint8Array, row: number, index: number) => number} The `index`th sample of a row, as stored */
function sampleReader(depth) {
  if (depth === 16) {
    return (rows, row, index) => (rows[row + index * 2] << 8) | rows[row + index * 2 + 1];
  }
  if (depth === 8) {
    return (rows, row, index) => rows[row + index];
  }

  const max = (1 << depth) - 1;

  return (rows, row, index) => {
    const bit = index * depth;

    return (rows[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & max;
  };
}

/** @returns {(value: number) => number} A sample scaled to 8 bits, rounding */
function scaleTo8(depth) {
  if (depth === 16) {
    return value => ((value + 128) / 257) | 0;
  }
  if (depth === 8) {
    return value => value;
  }

  const max = (1 << depth) - 1;

  return value => value * 255 / max;
}

/**
 * @returns {(rows: Uint8Array, row: number, x: number, to: number) => void} Writes the `x`th pixel
 *   of the row starting at `row` as RGBA at `to`
 */
function pixelWriter({ colorType, depth, palette, transparency, pixels }) {
  const sample = sampleReader(depth);
  const to8 = scaleTo8(depth);
  const max = (1 << depth) - 1;
  // tRNS for grey or RGB names one colour, in samples, that is fully transparent.
  const key = transparency && (colorType === 0 || colorType === 2) ?
    Array.from({ length: CHANNELS[colorType] }, (_, i) => ((transparency[i * 2] << 8) | transparency[i * 2 + 1]) & max) :
    null;

  switch (colorType) {
    case 0: return (rows, row, x, to) => {
      const grey = sample(rows, row, x);
      const value = to8(grey);

      pixels[to] = pixels[to + 1] = pixels[to + 2] = value;
      pixels[to + 3] = key && grey === key[0] ? 0 : 255;
    };
    case 2: return (rows, row, x, to) => {
      const r = sample(rows, row, x * 3);
      const g = sample(rows, row, x * 3 + 1);
      const b = sample(rows, row, x * 3 + 2);

      pixels[to] = to8(r);
      pixels[to + 1] = to8(g);
      pixels[to + 2] = to8(b);
      pixels[to + 3] = key && r === key[0] && g === key[1] && b === key[2] ? 0 : 255;
    };
    case 3: return (rows, row, x, to) => {
      const index = sample(rows, row, x);

      if (index * 3 + 2 >= palette.length) {
        throw new Error(`The PNG uses colour ${index} of a palette of ${palette.length / 3}`);
      }

      pixels[to] = palette[index * 3];
      pixels[to + 1] = palette[index * 3 + 1];
      pixels[to + 2] = palette[index * 3 + 2];
      pixels[to + 3] = transparency && index < transparency.length ? transparency[index] : 255;
    };
    case 4: return (rows, row, x, to) => {
      pixels[to] = pixels[to + 1] = pixels[to + 2] = to8(sample(rows, row, x * 2));
      pixels[to + 3] = to8(sample(rows, row, x * 2 + 1));
    };
    default: return (rows, row, x, to) => {
      for (let i = 0; i < 4; i++) {
        pixels[to + i] = to8(sample(rows, row, x * 4 + i));
      }
    };
  }
}
