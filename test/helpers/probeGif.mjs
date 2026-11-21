/**
 * Reads a GIF in Node, for the encoder spec and the e2e tests: its screen size, loop count, and
 * each frame's delay, disposal, palette and pixels.
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, loops: number|undefined, frames: GifFrame[] }}
 *
 * @typedef GifFrame
 * @property {number} delay In ms
 * @property {number} dispose Its disposal method: 0 or 1 keeps it, 2 clears it, 3 restores what was before
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {boolean} localPalette The frame has its own colour table rather than the GIF's
 * @property {number} colors How many entries its colour table has
 * @property {Uint8Array} rgb Its pixels, 3 bytes each
 * @property {Uint8Array} transparent 1 for each pixel of its transparent index, else 0
 * @property {number} distinctColors How many colours its opaque pixels use
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
  let dispose = 0;
  let transparentIndex = -1;

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
        dispose = (data[0] >> 2) & 7;
        transparentIndex = data[0] & 1 ? data[3] : -1;
      } else if (label === 0xff && new TextDecoder().decode(data.subarray(0, 11)) === 'NETSCAPE2.0') {
        loops = data[12] | (data[13] << 8);
      }
    } else if (block === 0x2c) {
      const x = u16();
      const y = u16();
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
      const opaque = indices.filter(index => index !== transparentIndex);

      frames.push({
        delay,
        dispose,
        x,
        y,
        width: frameWidth,
        height: frameHeight,
        localPalette: Boolean(packed & 0x80),
        colors: colors.length / 3,
        rgb,
        transparent: Uint8Array.from(indices, index => Number(index === transparentIndex)),
        distinctColors: new Set(opaque.map(index => colors.subarray(index * 3, index * 3 + 3).join())).size
      });
      delay = 0;
      dispose = 0;
      transparentIndex = -1;
    } else {
      throw new Error(`Unexpected GIF block 0x${block?.toString(16)} at ${at - 1}`);
    }
  }
}

/**
 * Plays a GIF as a browser does, onto a screen that starts transparent.
 * @param {ReturnType<typeof probeGif>} gif
 * @returns {Uint8Array[]} The screen's RGBA after each frame is drawn
 */
export function composeGif({ width, height, frames }) {
  let screen = new Uint8Array(width * height * 4);

  return frames.map(frame => {
    const before = screen.slice();
    const area = (fn) => {
      for (let row = 0; row < frame.height; row++) {
        for (let column = 0; column < frame.width; column++) {
          fn(row * frame.width + column, ((frame.y + row) * width + frame.x + column) * 4);
        }
      }
    };

    area((i, at) => {
      if (!frame.transparent[i]) {
        screen.set([...frame.rgb.subarray(i * 3, i * 3 + 3), 255], at);
      }
    });

    const shown = screen.slice();

    if (frame.dispose === 2) {
      area((_, at) => screen.fill(0, at, at + 4));
    } else if (frame.dispose === 3) {
      screen = before;
    }

    return shown;
  });
}

/**
 * Compares a composed GIF frame with the RGBA it was made from, whose alpha under 128 should be
 * transparent and the rest opaque in its colour, give or take the palette and a canvas's premultiplying.
 * @param {Uint8Array} screen One of composeGif()'s frames
 * @param {ArrayLike<number>} rgba
 * @returns {string|null} The first pixel that differs, or null
 */
export function oneBitAlphaMismatch(screen, rgba) {
  for (let at = 0; at < rgba.length; at += 4) {
    const opaque = rgba[at + 3] >= 128;
    const pixel = Array.from(screen.subarray(at, at + 4));

    if (pixel[3] !== (opaque ? 255 : 0) || (opaque && pixel.slice(0, 3).some((value, c) => Math.abs(value - rgba[at + c]) > 8))) {
      return `pixel ${at / 4}: got ${pixel}, want ${Array.from(rgba).slice(at, at + 4)}`;
    }
  }

  return null;
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
