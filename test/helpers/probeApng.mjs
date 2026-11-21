import fs from 'node:fs';
import zlib from 'node:zlib';
import JSZip from 'jszip';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Reads an APNG in Node, for the encoder and worker specs and the e2e tests, checking each chunk's
 * CRC and the sequence numbers on the way. Returns its size, colour type and play count, and each
 * frame's area, delay and the whole image as it shows once the frame is drawn. A PNG that isn't
 * animated reads as one frame with no delay or play count.
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, colorType: number, plays: number|undefined, chunks: string[], frames: ApngFrame[] }}
 *
 * @typedef ApngFrame
 * @property {number} x
 * @property {number} y
 * @property {number} width Of the area the frame draws
 * @property {number} height
 * @property {number} delay In ms
 * @property {number} dispose
 * @property {number} blend
 * @property {Uint8Array} rgba The whole image once the frame is drawn, 4 bytes a pixel
 */
export function probeApng(bytes) {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);

  if (!SIGNATURE.every((byte, i) => data[i] === byte)) {
    throw new Error('Not a PNG');
  }

  const chunks = [];

  for (let at = 8; at < data.length;) {
    const length = data.readUInt32BE(at);
    const type = data.toString('latin1', at + 4, at + 8);
    const body = data.subarray(at + 8, at + 8 + length);

    if (body.length !== length || at + 12 + length > data.length) {
      throw new Error(`${type} runs past the end`);
    }
    if (zlib.crc32(data.subarray(at + 4, at + 8 + length)) !== data.readUInt32BE(at + 8 + length)) {
      throw new Error(`${type} has a bad CRC`);
    }

    chunks.push({ type, body });
    at += 12 + length;
  }

  const types = chunks.map(chunk => chunk.type);

  if (types[0] !== 'IHDR' || types.at(-1) !== 'IEND' || (types.includes('acTL') && types.indexOf('acTL') > types.indexOf('IDAT'))) {
    throw new Error(`Chunks out of order: ${types.join(' ')}`);
  }

  const ihdr = chunks[0].body;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const colorType = ihdr[9];
  const bpp = { 2: 3, 6: 4 }[colorType];

  if (ihdr[8] !== 8 || !bpp || ihdr[10] || ihdr[11] || ihdr[12]) {
    throw new Error(`Unsupported IHDR: depth ${ihdr[8]}, colour type ${colorType}, ` +
      `compression ${ihdr[10]}, filter ${ihdr[11]}, interlace ${ihdr[12]}`);
  }

  const actl = chunks.find(chunk => chunk.type === 'acTL')?.body;
  const frames = actl ? [] : [{ x: 0, y: 0, width, height, delay: undefined, dispose: 0, blend: 0, parts: [] }];
  let sequence = 0;
  const nextSequence = body => {
    if (body.readUInt32BE(0) !== sequence) {
      throw new Error(`Sequence number ${body.readUInt32BE(0)}, expected ${sequence}`);
    }
    sequence++;
  };

  for (const { type, body } of chunks) {
    if (type === 'fcTL') {
      nextSequence(body);
      const denominator = body.readUInt16BE(22) || 100;

      frames.push({
        x: body.readUInt32BE(12),
        y: body.readUInt32BE(16),
        width: body.readUInt32BE(4),
        height: body.readUInt32BE(8),
        delay: body.readUInt16BE(20) * 1000 / denominator,
        dispose: body[24],
        blend: body[25],
        parts: []
      });
    } else if (type === 'IDAT') {
      if (!frames.length) {
        throw new Error('The image before the first fcTL is not a frame, which this does not read');
      }
      frames.at(-1).parts.push(body);
    } else if (type === 'fdAT') {
      nextSequence(body);
      frames.at(-1).parts.push(body.subarray(4));
    }
  }

  if (actl && frames.length !== actl.readUInt32BE(0)) {
    throw new Error(`acTL says ${actl.readUInt32BE(0)} frames, but there are ${frames.length}`);
  }

  const canvas = new Uint8Array(width * height * 4);

  frames.forEach((frame, index) => {
    if (index === 0 && (frame.x || frame.y || frame.width !== width || frame.height !== height)) {
      throw new Error('The first frame is not the whole image');
    }
    if (!frame.width || !frame.height) {
      throw new Error(`Frame ${index + 1} is empty`);
    }
    if (frame.x + frame.width > width || frame.y + frame.height > height) {
      throw new Error(`Frame ${index + 1} runs off the image`);
    }
    if (frame.dispose !== 0 || frame.blend !== 0) {
      throw new Error(`Frame ${index + 1}: only dispose none and blend source are read`);
    }

    const pixels = unfilter(zlib.inflateSync(Buffer.concat(frame.parts)), frame.width, frame.height, bpp);

    for (let row = 0; row < frame.height; row++) {
      for (let column = 0; column < frame.width; column++) {
        const from = (row * frame.width + column) * bpp;
        const to = ((frame.y + row) * width + frame.x + column) * 4;

        canvas.set(pixels.subarray(from, from + 3), to);
        canvas[to + 3] = bpp === 4 ? pixels[from + 3] : 255;
      }
    }

    delete frame.parts;
    frame.rgba = canvas.slice();
  });

  return { width, height, colorType, plays: actl?.readUInt32BE(4), chunks: types, frames };
}

/**
 * @param {Uint8Array} data Inflated image data: each row its filter type, then its bytes
 * @returns {Uint8Array} The unfiltered pixels
 */
function unfilter(data, width, height, bpp) {
  const length = width * bpp;

  if (data.length !== (length + 1) * height) {
    throw new Error(`Image data is ${data.length} bytes, expected ${(length + 1) * height}`);
  }

  const out = new Uint8Array(length * height);

  for (let row = 0; row < height; row++) {
    const filter = data[row * (length + 1)];
    const line = data.subarray(row * (length + 1) + 1, (row + 1) * (length + 1));

    for (let i = 0; i < length; i++) {
      const at = row * length + i;
      const a = i < bpp ? 0 : out[at - bpp];
      const b = row ? out[at - length] : 0;
      const c = i < bpp || !row ? 0 : out[at - length - bpp];
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const prediction = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];

      if (prediction === undefined) {
        throw new Error(`Row ${row} has filter type ${filter}`);
      }

      out[at] = line[i] + prediction;
    }
  }

  return out;
}

/**
 * @param {ApngFrame[]} frames
 * @param {number[][]} colors One RGB colour per frame
 * @returns {boolean} Every frame is its colour, within JPEG's error, and opaque
 */
export function nearColors(frames, colors) {
  return frames.length === colors.length && frames.every((frame, i) => frame.rgba.every(
    (value, at) => (at % 4 === 3 ? value === 255 : Math.abs(value - colors[i][at % 4]) <= 4)
  ));
}

/**
 * @param {ApngFrame} frame
 * @param {number} width The image's
 * @returns {number[]} The RGBA of the pixel at x, y
 */
export function pixelAt(frame, width, x, y) {
  return [...frame.rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
}

/**
 * test/fixtures/pixiv/illust-ugoira-frames-moving.zip: four 37x35 RGBA PNG frames (ImageMagick's),
 * an opaque 5x4 square moving 7px right and 4px down a frame over still stripes of alpha 3, 128,
 * 255, 0 (its colour kept) and 200, for these delays. Each frame after the first changes the 12x8
 * area spanning the square before and after.
 */
export const MOVING = {
  zip: new URL('../fixtures/pixiv/illust-ugoira-frames-moving.zip', import.meta.url),
  delays: [50, 70, 90, 110],
  areas: [[0, 0, 37, 35], [6, 9, 12, 8], [13, 13, 12, 8], [20, 17, 12, 8]]
};

/**
 * @param {URL|string} zip A frames zip of PNGs
 * @returns {Promise<number[][]>} Each frame's RGBA, in the zip's order
 */
export async function zipFrames(zip) {
  const frames = await JSZip.loadAsync(fs.readFileSync(zip));

  return Promise.all(Object.values(frames.files).map(async file =>
    Array.from(probeApng(await file.async('uint8array')).frames[0].rgba)));
}

/**
 * @param {string} type
 * @param {ArrayLike<number>} data
 * @returns {Buffer} A whole PNG chunk: length, type, data and CRC
 */
export function pngChunk(type, data) {
  const bytes = Buffer.alloc(12 + data.length);

  bytes.writeUInt32BE(data.length);
  bytes.write(type, 4, 'latin1');
  Buffer.from(data).copy(bytes, 8);
  bytes.writeUInt32BE(zlib.crc32(bytes.subarray(4, 8 + data.length)), 8 + data.length);

  return bytes;
}
