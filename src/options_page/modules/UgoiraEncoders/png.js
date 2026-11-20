/**
 * A PNG decoder for the APNG worker. A canvas would premultiply alpha and lose semi-transparent
 * pixels' colour, so PNG frames are read here instead, exactly.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Colour type → samples per pixel. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Colour type → the bit depths PNG allows with it. */
const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

/** Adam7's passes: x and y of the first pixel, then the step between pixels. */
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

/** The chunks that say how to read the colours, which the APNG carries over from the frames. */
export const COLOR_CHUNKS = ['cHRM', 'gAMA', 'iCCP', 'sRGB'];

/**
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export const isPng = bytes => SIGNATURE.every((byte, i) => bytes[i] === byte);

/**
 * @param {Uint8Array} bytes A PNG
 * @param {(type: string, data: Uint8Array) => void} visit Called for each chunk in order
 * @param {string} [stopAt] A chunk type to stop at without reading it, so it may be cut short
 * @returns {boolean} Whether it reached `stopAt`
 */
function eachChunk(bytes, visit, stopAt) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);

  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));

    if (type === stopAt) {
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
 * What a frame's header says, read from the start of the file only.
 * @param {Blob} image
 * @returns {Promise<{ png: boolean, alpha: boolean, colorChunks: { type: string, data: Uint8Array }[] }>}
 *   Whether it is a PNG, whether it has alpha (colour type 4 or 6, or a tRNS chunk), and its colour chunks
 */
export async function readPngHeader(image) {
  // Everything before the image data: IHDR, the palette and the colour chunks, ICC profile and all.
  let bytes = new Uint8Array(await image.slice(0, 64 * 1024).arrayBuffer());

  if (!isPng(bytes)) {
    return { png: false, alpha: false, colorChunks: [] };
  }

  let header;

  for (;;) {
    try {
      header = scanHeader(bytes);
      break;
    } catch (error) {
      if (bytes.length >= image.size) {
        throw error;
      }

      bytes = new Uint8Array(await image.slice(0, bytes.length * 4).arrayBuffer());
    }
  }

  return { png: true, ...header };
}

/**
 * @param {Uint8Array} bytes The start of a PNG, through its first IDAT chunk's header
 * @returns {{ alpha: boolean, colorChunks: { type: string, data: Uint8Array }[] }}
 */
function scanHeader(bytes) {
  let colorType;
  let transparency = false;
  const colorChunks = [];
  const reachedData = eachChunk(bytes, (type, data) => {
    if (type === 'IHDR') {
      colorType = data[9];
    } else if (type === 'tRNS') {
      transparency = true;
    } else if (COLOR_CHUNKS.includes(type)) {
      colorChunks.push({ type, data: data.slice() });
    }
  }, 'IDAT');

  if (!reachedData || colorType === undefined) {
    throw new Error('The PNG has no image data');
  }

  return { alpha: colorType === 4 || colorType === 6 || transparency, colorChunks };
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>} The zlib stream inflated
 */
async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));

  return new Uint8Array(await new Response(stream).arrayBuffer());
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
  let prior = new Uint8Array(rowBytes);

  for (let y = 0; y < rows; y++) {
    const filter = data[at + y * (rowBytes + 1)];
    const from = at + y * (rowBytes + 1) + 1;
    const row = y * rowBytes;
    const left = Math.min(bpp, rowBytes);

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
 * management. 16-bit samples round to 8 bits.
 * @param {Uint8Array} bytes
 * @returns {Promise<{ pixels: Uint8Array, width: number, height: number }>}
 */
export async function decodePng(bytes) {
  if (!isPng(bytes)) {
    throw new Error('Not a PNG');
  }

  let ihdr;
  let palette;
  let transparency;
  const idat = [];

  eachChunk(bytes, (type, data) => {
    if (type === 'IHDR') {
      ihdr = data;
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    }
  });

  if (!ihdr || ihdr.length < 13) {
    throw new Error('The PNG has no IHDR chunk');
  }

  const header = new DataView(ihdr.buffer, ihdr.byteOffset, 13);
  const width = header.getUint32(0);
  const height = header.getUint32(4);
  const [depth, colorType, compression, filterMethod, interlace] = ihdr.subarray(8, 13);

  if (!width || !height || !DEPTHS[colorType]?.includes(depth) || compression || filterMethod || interlace > 1) {
    throw new Error(`The PNG's IHDR is not one PNG allows: ${width}x${height}, depth ${depth}, ` +
      `colour type ${colorType}, compression ${compression}, filter ${filterMethod}, interlace ${interlace}`);
  }
  if (colorType === 3 && !palette) {
    throw new Error('The PNG has a palette colour type but no palette');
  }
  if (!idat.length) {
    throw new Error('The PNG has no image data');
  }

  const data = await inflate(idat.length === 1 ? idat[0] : concat(idat));
  const channels = CHANNELS[colorType];
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const pixels = new Uint8Array(width * height * 4);
  const writePixel = pixelWriter({ colorType, depth, palette, transparency, pixels });
  const passes = interlace ? ADAM7 : [[0, 0, 1, 1]];
  let at = 0;

  for (const [x0, y0, dx, dy] of passes) {
    const passWidth = Math.ceil((width - x0) / dx);
    const passHeight = Math.ceil((height - y0) / dy);

    if (passWidth <= 0 || passHeight <= 0) {
      continue;
    }

    const rowBytes = Math.ceil(passWidth * bitsPerPixel / 8);

    if (at + passHeight * (rowBytes + 1) > data.length) {
      throw new Error('The PNG\'s image data is too short');
    }

    const rows = unfilter(data, passHeight, rowBytes, bpp, at);

    for (let y = 0; y < passHeight; y++) {
      const row = y * rowBytes;
      const to = ((y0 + y * dy) * width + x0) * 4;

      // 8-bit RGBA and RGB, the PNGs Pixiv serves, outside interlacing's scattered pixels.
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

/**
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array}
 */
function concat(parts) {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

/**
 * @returns {(rows: Uint8Array, row: number, x: number, to: number) => void} Writes the `x`th pixel
 *   of the row starting at `row` as RGBA at `to`
 */
function pixelWriter({ colorType, depth, palette, transparency, pixels }) {
  const channels = CHANNELS[colorType];
  const max = (1 << depth) - 1;
  /** The `index`th sample of the row, as it is stored: up to 16 bits. */
  const sample = depth === 16 ?
    (rows, row, index) => (rows[row + index * 2] << 8) | rows[row + index * 2 + 1] :
    depth === 8 ?
      (rows, row, index) => rows[row + index] :
      (rows, row, index) => {
        const bit = index * depth;

        return (rows[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & max;
      };
  /** A sample scaled to 8 bits, rounding. */
  const to8 = depth === 16 ? value => ((value + 128) / 257) | 0 : depth === 8 ? value => value : value => value * 255 / max;
  // tRNS for grey or RGB names one colour, in samples, that is fully transparent.
  const key = transparency && (colorType === 0 || colorType === 2) ?
    Array.from({ length: channels }, (_, i) => ((transparency[i * 2] << 8) | transparency[i * 2 + 1]) & max) :
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
