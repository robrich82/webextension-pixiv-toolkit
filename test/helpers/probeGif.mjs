/**
 * Reads a GIF in Node, for the encoder spec and the e2e tests: its screen size, loop count, and
 * each frame's delay, palette and pixels.
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, loops: number|undefined, frames: GifFrame[] }}
 *
 * @typedef GifFrame
 * @property {number} delay In ms
 * @property {number} width
 * @property {number} height
 * @property {boolean} localPalette The frame has its own colour table rather than the GIF's
 * @property {number} colors How many entries its colour table has
 * @property {Uint8Array} rgb Its pixels, 3 bytes each
 * @property {number} distinctColors How many colours its pixels use
 */
export function probeGif(bytes) {
  let at = 0;
  const byte = () => bytes[at++];
  const u16 = () => bytes[at++] | (bytes[at++] << 8);
  const table = packed => {
    const size = 2 << (packed & 7);
    const colors = bytes.subarray(at, at + size * 3);
    at += size * 3;
    return colors;
  };
  const subBlocks = () => {
    const parts = [];
    for (let size = byte(); size; size = byte()) {
      parts.push(bytes.subarray(at, at + size));
      at += size;
    }
    return Uint8Array.from(parts.flatMap(part => [...part]));
  };

  const signature = new TextDecoder().decode(bytes.subarray(0, 6));
  if (signature !== 'GIF89a') {
    throw new Error(`Not a GIF89a: ${signature}`);
  }
  at = 6;

  const width = u16();
  const height = u16();
  const screen = byte();
  at += 2; // background colour, aspect ratio
  const globalTable = screen & 0x80 ? table(screen) : null;
  const frames = [];
  let loops;
  let delay = 0;

  for (;;) {
    const block = byte();

    if (block === 0x3b) {
      return { width, height, loops, frames };
    }

    if (block === 0x21) {
      const label = byte();
      const data = subBlocks();

      if (label === 0xf9) {
        delay = (data[1] | (data[2] << 8)) * 10;
      } else if (label === 0xff && new TextDecoder().decode(data.subarray(0, 11)) === 'NETSCAPE2.0') {
        loops = data[12] | (data[13] << 8);
      }
    } else if (block === 0x2c) {
      at += 4; // left, top
      const frameWidth = u16();
      const frameHeight = u16();
      const packed = byte();
      const colors = packed & 0x80 ? table(packed) : globalTable;
      const minCodeSize = byte();
      const indices = lzwDecode(minCodeSize, subBlocks(), frameWidth * frameHeight);

      if (indices.length !== frameWidth * frameHeight) {
        throw new Error(`GIF frame ${frames.length + 1} decodes to ${indices.length} pixels, not its ${frameWidth * frameHeight}`);
      }

      const rgb = new Uint8Array(indices.length * 3);

      indices.forEach((index, i) => rgb.set(colors.subarray(index * 3, index * 3 + 3), i * 3));
      frames.push({
        delay,
        width: frameWidth,
        height: frameHeight,
        localPalette: Boolean(packed & 0x80),
        colors: colors.length / 3,
        rgb,
        distinctColors: new Set(indices.map(index => colors.subarray(index * 3, index * 3 + 3).join())).size
      });
      delay = 0;
    } else {
      throw new Error(`Unexpected GIF block 0x${block?.toString(16)} at ${at - 1}`);
    }
  }
}

/**
 * @param {GifFrame[]} frames
 * @param {number[][]} colors One per frame, which every pixel of it should be within 4 of per channel
 * @returns {boolean}
 */
export function nearColors(frames, colors) {
  return frames.length === colors.length && frames.every((frame, i) => frame.rgb.every(
    (value, at) => Math.abs(value - colors[i][at % 3]) <= 4
  ));
}

/**
 * @param {number} minCodeSize
 * @param {Uint8Array} data
 * @param {number} count Pixels in the frame
 * @returns {number[]} Colour indices
 */
function lzwDecode(minCodeSize, data, count) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out = [];
  let size, dict, previous;
  let bits = 0;
  let buffer = 0;
  const reset = () => {
    size = minCodeSize + 1;
    dict = Array.from({ length: clear + 2 }, (_, i) => [i]);
    previous = null;
  };

  reset();

  for (const value of data) {
    buffer |= value << bits;
    bits += 8;

    while (bits >= size) {
      const code = buffer & ((1 << size) - 1);
      buffer >>>= size;
      bits -= size;

      if (code === clear) {
        reset();
        continue;
      }

      if (code === end) {
        // Whole: probeGif() rejects a frame that decodes short or long.
        return out;
      }

      let entry;

      if (code < dict.length) {
        entry = dict[code];
      } else if (code === dict.length && previous) {
        entry = [...previous, previous[0]];
      } else {
        throw new Error(`Bad LZW code ${code}`);
      }

      out.push(...entry);

      if (previous && dict.length < 4096) {
        dict.push([...previous, entry[0]]);

        if (dict.length === 1 << size && size < 12) {
          size++;
        }
      }

      previous = entry;
    }
  }

  throw new Error(`A GIF frame's LZW data ends without an end code, after ${out.length} of its ${count} pixels`);
}
