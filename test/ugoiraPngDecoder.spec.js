/**
 * png.js against PNGs ImageMagick 7.1 wrote in every colour type and bit depth, with and without
 * tRNS and Adam7 interlacing, and its RGBA decode of each (`magick <f>.png -depth 8 rgba:<f>.rgba`).
 */
import fs from 'node:fs';
import JSZip from 'jszip';
import { decodePng, isPng, readPngHeader } from '@/options_page/modules/UgoiraEncoders/png';

const suite = await JSZip.loadAsync(fs.readFileSync(new URL('./fixtures/png/decoder-suite.zip', import.meta.url)));
const names = Object.keys(suite.files).filter(name => name.endsWith('.png')).map(name => name.slice(0, -4));
const file = name => suite.file(name).async('uint8array');

/** The IHDR fields a fixture was written with, so the table shows what each row covers. */
const ihdr = bytes => ({ depth: bytes[24], colorType: bytes[25], interlace: bytes[28] });

test('the suite covers every colour type and bit depth, tRNS and interlacing', async () => {
  const seen = new Set();

  for (const name of names) {
    const { depth, colorType, interlace } = ihdr(await file(`${name}.png`));
    seen.add(`${colorType}/${depth}`);
    seen.add(`interlace ${interlace}`);
  }

  expect([...seen].sort()).toEqual([
    '0/1', '0/16', '0/2', '0/4', '0/8', '2/16', '2/8', '3/1', '3/2', '3/4', '3/8', '4/16', '4/8', '6/16', '6/8',
    'interlace 0', 'interlace 1'
  ]);
});

test.each(names)('%s decodes as ImageMagick does', async name => {
  const bytes = await file(`${name}.png`);
  const expected = await file(`${name}.rgba`);
  const { pixels, width, height } = await decodePng(bytes);

  expect(width * height * 4).toBe(expected.length);
  expect(Buffer.from(pixels).equals(Buffer.from(expected))).toBe(true);
});

test('image data split over several IDAT chunks, as libpng writes it, decodes the same', async () => {
  const png = await file('rgba16-i.png');
  const { at, length } = findChunk(png, 'IDAT');
  const data = png.subarray(at + 8, at + 8 + length);
  const thirds = [0, 1, 2].map(i => data.subarray(Math.floor(i * length / 3), Math.floor((i + 1) * length / 3)));
  const split = new Uint8Array([...png.subarray(0, at), ...thirds.flatMap(part => [...chunk('IDAT', part)]), ...png.subarray(at + 12 + length)]);

  expect((await decodePng(split)).pixels).toEqual((await decodePng(png)).pixels);
});

test('semi-transparent pixels keep their colour', async () => {
  const { pixels } = await decodePng(await file('rgba8.png'));
  const expected = await file('rgba8.rgba');
  const partial = [];

  for (let i = 3; i < pixels.length; i += 4) {
    if (expected[i] > 0 && expected[i] < 64) {
      partial.push(i);
    }
  }

  // A canvas would premultiply these and lose most of their colour.
  expect(partial.length).toBeGreaterThan(5);
  expect(partial.map(i => [...pixels.subarray(i - 3, i + 1)])).toEqual(partial.map(i => [...expected.subarray(i - 3, i + 1)]));
});

describe('readPngHeader', () => {
  test.each([
    ['rgb8', false], ['rgba8', true], ['ga8', true], ['g8', false], ['gt8', true], ['rgbt8', true],
    ['p4', false], ['pt8', true], ['pa8', true]
  ])('%s has alpha: %s', async (name, alpha) => {
    expect(await readPngHeader(new Blob([await file(`${name}.png`)]))).toMatchObject({ png: true, alpha });
  });

  test('a JPEG is not a PNG and has no alpha', async () => {
    expect(await readPngHeader(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]))).toEqual({ png: false, alpha: false, colorChunks: [] });
  });

  test('keeps the colour chunks, reading past the first 64KB when an ICC profile is that big', async () => {
    const png = await file('rgb8.png');
    const profile = new Uint8Array(100 * 1024).map((_, i) => i);
    const withProfile = insertChunks(png, [chunk('gAMA', new Uint8Array([0, 0, 0xb1, 0x8f])), chunk('iCCP', profile)]);

    const header = await readPngHeader(new Blob([withProfile]));

    expect(header.alpha).toBe(false);
    expect(header.colorChunks.map(({ type, data }) => [type, data.length])).toEqual([['gAMA', 4], ['iCCP', profile.length]]);
    expect(header.colorChunks[1].data).toEqual(profile);
  });

  test('a PNG with no image data is refused', async () => {
    const png = await file('rgb8.png');

    await expect(readPngHeader(new Blob([png.subarray(0, 33)]))).rejects.toThrow('no image data');
  });
});

describe('decodePng refuses', () => {
  const broken = async (name, edit) => {
    const bytes = (await file(`${name}.png`)).slice();
    edit(bytes);
    return bytes;
  };

  test.each([
    ['not a PNG', bytes => { bytes[1] = 0; }, 'Not a PNG'],
    ['a depth the colour type does not allow', bytes => { bytes[24] = 4; }, 'depth 4, colour type 2'],
    ['a compression method', bytes => { bytes[26] = 1; }, 'compression 1'],
    ['a filter method', bytes => { bytes[27] = 1; }, 'filter 1'],
    ['an unknown interlace', bytes => { bytes[28] = 2; }, 'interlace 2'],
    ['a zero width', bytes => { bytes.fill(0, 16, 20); }, '0x9']
  ])('%s', async (_, edit, message) => {
    await expect(decodePng(await broken('rgb8', edit))).rejects.toThrow(message);
  });

  test.each([['IHDR', 'no IHDR'], ['IDAT', 'no image data']])('a PNG with no %s chunk', async (type, message) => {
    const png = await file('rgb8.png');
    const { at, length } = findChunk(png, type);

    await expect(decodePng(new Uint8Array([...png.subarray(0, at), ...png.subarray(at + 12 + length)]))).rejects.toThrow(message);
  });

  test('a chunk that runs past the end', async () => {
    const png = await file('rgb8.png');

    await expect(decodePng(png.subarray(0, png.length - 20))).rejects.toThrow('runs past its end');
  });

  test('image data that inflates short', async () => {
    const png = await file('rgb8.png');
    const short = insertChunks(png.subarray(0, 33), [chunk('IDAT', new Uint8Array([0x78, 0x9c, 0x63, 0, 0, 0, 1, 0, 1])), chunk('IEND', new Uint8Array())], 33);

    await expect(decodePng(short)).rejects.toThrow('too short');
  });

  test('a palette colour type with no palette', async () => {
    const png = await file('p4.png');
    const { at, length } = findChunk(png, 'PLTE');
    const noPalette = new Uint8Array([...png.subarray(0, at), ...png.subarray(at + 12 + length)]);

    await expect(decodePng(noPalette)).rejects.toThrow('no palette');
  });

  test('a pixel past the end of the palette', async () => {
    const png = await file('p4.png');
    const { at, length } = findChunk(png, 'PLTE');
    // Keep only the first colour.
    const shortPalette = new Uint8Array([...png.subarray(0, at), ...chunk('PLTE', png.subarray(at + 8, at + 11)), ...png.subarray(at + 12 + length)]);

    expect(length).toBeGreaterThan(3);
    await expect(decodePng(shortPalette)).rejects.toThrow('of a palette of 1');
  });

  test('a row with an unknown filter', async () => {
    const zlib = await import('node:zlib');
    const png = await file('g8.png');
    // 13x9 grey: rows of 1 filter byte + 13 samples; the first row's filter is 5.
    const rows = new Uint8Array(9 * 14);
    rows[0] = 5;
    const bad = insertChunks(png.subarray(0, 33), [chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', new Uint8Array())], 33);

    await expect(decodePng(bad)).rejects.toThrow('unknown filter, 5');
  });
});

test('isPng', () => {
  expect(isPng(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(true);
  expect(isPng(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
});

/** A whole chunk: length, type, data and CRC. */
function chunk(type, data) {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, data.length);
  bytes.set([...type].map(char => char.charCodeAt(0)), 4);
  bytes.set(data, 8);
  view.setUint32(8 + data.length, crc(bytes.subarray(4, 8 + data.length)));

  return bytes;
}

function crc(bytes) {
  let value = ~0;

  for (const byte of bytes) {
    value ^= byte;
    for (let k = 0; k < 8; k++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
  }

  return ~value >>> 0;
}

/** The PNG with `chunks` inserted at `at`, right after IHDR by default. */
function insertChunks(png, chunks, at = 33) {
  return new Uint8Array([...png.subarray(0, at), ...chunks.flatMap(part => [...part]), ...png.subarray(at)]);
}

function findChunk(png, type) {
  const view = new DataView(png.buffer, png.byteOffset, png.length);

  for (let at = 8; at < png.length; at += 12 + view.getUint32(at)) {
    if (String.fromCharCode(...png.subarray(at + 4, at + 8)) === type) {
      return { at, length: view.getUint32(at) };
    }
  }

  throw new Error(`No ${type}`);
}
