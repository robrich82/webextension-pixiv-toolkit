/**
 * png.js against PNGs ImageMagick 7.1 wrote in every colour type and bit depth, with and without
 * tRNS and Adam7 interlacing, and its RGBA decode of each (`magick <f>.png -depth 8 rgba:<f>.rgba`).
 * Those images are smooth, so every filter is also run over noise, from PNGs built here.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import JSZip from 'jszip';
import { MAX_PIXELS, decodePng, isPng, readPngHeader } from '@/options_page/modules/UgoiraEncoders/png';
import { pngChunk } from './helpers/probeApng.mjs';

const suite = await JSZip.loadAsync(fs.readFileSync(new URL('./fixtures/png/decoder-suite.zip', import.meta.url)));
const names = Object.keys(suite.files).filter(name => name.endsWith('.png')).map(name => name.slice(0, -4));
const file = name => suite.file(name).async('uint8array');

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG of `rows` (each its filter byte, then its bytes), with `chunks` between IHDR and IDAT. */
const png = ({ width, height, depth = 8, colorType, interlace = 0 }, rows, chunks = [], after = []) => {
  const ihdr = Buffer.alloc(13);

  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([depth, colorType, 0, 0, interlace], 8);

  return new Uint8Array(Buffer.concat([
    Buffer.from(SIGNATURE), pngChunk('IHDR', ihdr), ...chunks, pngChunk('IDAT', zlib.deflateSync(Uint8Array.from(rows))), pngChunk('IEND', []),
    Buffer.from(after)
  ]));
};

/** Filters raw rows with one PNG filter type, as an encoder would. */
const filterRows = (raw, rows, rowBytes, bpp, filter) => {
  const out = new Uint8Array(rows * (rowBytes + 1));

  for (let y = 0; y < rows; y++) {
    out[y * (rowBytes + 1)] = filter;
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? raw[y * rowBytes + i - bpp] : 0;
      const b = y ? raw[(y - 1) * rowBytes + i] : 0;
      const c = y && i >= bpp ? raw[(y - 1) * rowBytes + i - bpp] : 0;
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      const predicted = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];

      out[y * (rowBytes + 1) + 1 + i] = (raw[y * rowBytes + i] - predicted) & 255;
    }
  }

  return out;
};

const ihdrOf = bytes => ({ depth: bytes[24], colorType: bytes[25], interlace: bytes[28] });

/** The PNG with the first `type` chunk replaced by `replacements`, or removed. */
const replaceChunk = (bytes, type, ...replacements) => {
  const { at, length } = findChunk(bytes, type);

  return new Uint8Array(Buffer.concat([bytes.subarray(0, at), ...replacements, bytes.subarray(at + 12 + length)]));
};

test('the suite covers every colour type and bit depth, and interlacing', async () => {
  const seen = new Set();

  for (const name of names) {
    const { depth, colorType, interlace } = ihdrOf(await file(`${name}.png`));
    seen.add(`${colorType}/${depth}`);
    seen.add(`interlace ${interlace}`);
  }

  expect([...seen].sort()).toEqual([
    '0/1', '0/16', '0/2', '0/4', '0/8', '2/16', '2/8', '3/1', '3/2', '3/4', '3/8', '4/16', '4/8', '6/16', '6/8',
    'interlace 0', 'interlace 1'
  ]);
});

test.each(names)('%s decodes as ImageMagick does', async name => {
  const expected = await file(`${name}.rgba`);
  const { pixels, width, height } = await decodePng(await file(`${name}.png`));

  expect(width * height * 4).toBe(expected.length);
  expect(Buffer.from(pixels).equals(Buffer.from(expected))).toBe(true);
});

describe.each([
  ['RGBA', 6, 8, 4], ['RGB', 2, 8, 3], ['grey', 0, 8, 1], ['grey and alpha', 4, 8, 2], ['16-bit RGBA', 6, 16, 8]
])('%s noise', (_, colorType, depth, bpp) => {
  test.each([0, 1, 2, 3, 4])('under filter %i decodes exactly', async filter => {
    const [width, height] = [11, 7];
    let seed = filter * 97 + colorType * 13 + depth;
    const raw = Uint8Array.from({ length: width * height * bpp }, () => (seed = (seed * 1664525 + 1013904223) >>> 0) >>> 24);
    const sample = (pixel, i) => depth === 16 ?
      ((((raw[pixel * bpp + i * 2] << 8) | raw[pixel * bpp + i * 2 + 1]) + 128) / 257) | 0 :
      raw[pixel * bpp + i];
    const expected = Array.from({ length: width * height }, (_, p) => ({
      6: [sample(p, 0), sample(p, 1), sample(p, 2), sample(p, 3)],
      2: [sample(p, 0), sample(p, 1), sample(p, 2), 255],
      0: [sample(p, 0), sample(p, 0), sample(p, 0), 255],
      4: [sample(p, 0), sample(p, 0), sample(p, 0), sample(p, 1)]
    })[colorType]).flat();

    const { pixels } = await decodePng(png({ width, height, depth, colorType }, filterRows(raw, height, width * bpp, bpp, filter)));

    expect(Array.from(pixels)).toEqual(expected);
  });
});

test('image data split over several IDAT chunks, as libpng writes it, decodes the same', async () => {
  const bytes = await file('rgba16-i.png');
  const { at, length } = findChunk(bytes, 'IDAT');
  const data = bytes.subarray(at + 8, at + 8 + length);
  const thirds = [0, 1, 2].map(i => pngChunk('IDAT', data.subarray(Math.floor(i * length / 3), Math.floor((i + 1) * length / 3))));

  expect((await decodePng(replaceChunk(bytes, 'IDAT', ...thirds))).pixels).toEqual((await decodePng(bytes)).pixels);
});

describe('tRNS', () => {
  test('a grey key makes the pixels of that value transparent', async () => {
    const { pixels } = await decodePng(png({ width: 3, height: 1, colorType: 0 }, [0, 19, 20, 19], [pngChunk('tRNS', [0, 19])]));

    expect(Array.from(pixels)).toEqual([19, 19, 19, 0, 20, 20, 20, 255, 19, 19, 19, 0]);
  });

  test('a 2-bit grey key', async () => {
    const { pixels } = await decodePng(png({ width: 4, height: 1, depth: 2, colorType: 0 }, [0, 0b00011011], [pngChunk('tRNS', [0, 2])]));

    expect(Array.from(pixels)).toEqual([0, 0, 0, 255, 85, 85, 85, 255, 170, 170, 170, 0, 255, 255, 255, 255]);
  });

  test('a 16-bit grey key compares all 16 bits, not the rounded value', async () => {
    // 0x1300 and 0x1301 both round to 19.
    const { pixels } = await decodePng(png({ width: 2, height: 1, depth: 16, colorType: 0 }, [0, 0x13, 0x00, 0x13, 0x01], [pngChunk('tRNS', [0x13, 0x01])]));

    expect([pixels[3], pixels[7]]).toEqual([255, 0]);
  });

  test('an RGB key needs all three samples to match', async () => {
    const { pixels } = await decodePng(png({ width: 2, height: 1, colorType: 2 }, [0, 0, 255, 0, 0, 1, 1], [pngChunk('tRNS', [0, 0, 0, 255, 0, 0])]));

    expect(Array.from(pixels)).toEqual([0, 255, 0, 0, 0, 1, 1, 255]);
  });

  // libpng ignores these, so browsers show the pixels opaque.
  test.each([
    ['too short for grey', 0, [pngChunk('tRNS', [0])]],
    ['too long for grey', 0, [pngChunk('tRNS', [0, 0, 0, 0])]],
    ['too short for RGB', 2, [pngChunk('tRNS', [0, 0])]],
    ['too long for RGB', 2, [pngChunk('tRNS', [0, 0, 0, 0, 0, 0, 0, 0])]],
    ['empty, on RGB', 2, [pngChunk('tRNS', [])]],
    ['on RGBA', 6, [pngChunk('tRNS', [0, 0, 0, 0, 0, 0])]],
    ['longer than the palette', 3, [pngChunk('PLTE', [0, 0, 0]), pngChunk('tRNS', [10, 20])]],
    ['empty, on a palette', 3, [pngChunk('PLTE', [0, 0, 0]), pngChunk('tRNS', [])]],
    ['before the palette', 3, [pngChunk('tRNS', [10]), pngChunk('PLTE', [0, 0, 0])]]
  ])('one %s is ignored, and gives no alpha', async (_, colorType, chunks) => {
    const bpp = { 0: 1, 2: 3, 3: 1, 6: 4 }[colorType];
    const bytes = png({ width: 1, height: 1, colorType }, [0, ...new Array(bpp).fill(0)], chunks);

    expect((await decodePng(bytes)).pixels[3]).toBe(colorType === 6 ? 0 : 255);
    expect((await readPngHeader(new Blob([bytes]))).alpha).toBe(colorType === 6);
  });

  test('a palette counts only as far as the bit depth can index, as libpng truncates it', async () => {
    // A 1-bit image indexes two colours, so of this three-colour palette's tRNS only two entries can count.
    const palette = pngChunk('PLTE', [1, 1, 1, 2, 2, 2, 3, 3, 3]);
    const of = trns => png({ width: 1, height: 1, depth: 1, colorType: 3 }, [0, 0], [palette, pngChunk('tRNS', trns)]);

    expect((await decodePng(of([7, 8, 9]))).pixels[3]).toBe(255);
    expect((await readPngHeader(new Blob([of([7, 8, 9])]))).alpha).toBe(false);
    expect((await decodePng(of([7, 8]))).pixels[3]).toBe(7);
  });

  test.each([
    ['a later valid one', [0, 20]],
    ['a later invalid one', [0]]
  ])('the first valid one applies, and %s changes nothing', async (_, later) => {
    const bytes = png({ width: 2, height: 1, colorType: 0 }, [0, 19, 20], [pngChunk('tRNS', [0, 19]), pngChunk('tRNS', later)]);

    expect(Array.from((await decodePng(bytes)).pixels)).toEqual([19, 19, 19, 0, 20, 20, 20, 255]);
  });

  test('an invalid one does not stop a later valid one', async () => {
    const bytes = png({ width: 2, height: 1, colorType: 0 }, [0, 19, 20], [pngChunk('tRNS', [0]), pngChunk('tRNS', [0, 19])]);

    expect(Array.from((await decodePng(bytes)).pixels)).toEqual([19, 19, 19, 0, 20, 20, 20, 255]);
    expect((await readPngHeader(new Blob([bytes]))).alpha).toBe(true);
  });
});

describe('image data', () => {
  const rgb = png({ width: 1, height: 1, colorType: 2 }, [0, 1, 2, 3]);
  const withIdat = (...data) => replaceChunk(rgb, 'IDAT', pngChunk('IDAT', Buffer.concat(data.map(part => Buffer.from(part)))));
  const zlibOf = rows => zlib.deflateSync(Uint8Array.from(rows));
  /**
   * A DecompressionStream that refuses its input, as the browsers' does bytes after the zlib stream,
   * and refuses no input at all when it ends.
   */
  const refusing = () => vi.stubGlobal('DecompressionStream', class {
    constructor() {
      const refuse = () => { throw new TypeError('Junk found after end of compressed data.'); };

      return new TransformStream({ transform: refuse, flush: refuse });
    }
  });
  const debug = () => vi.spyOn(console, 'debug').mockImplementation(() => {});

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('bytes after the zlib stream are ignored', async () => {
    expect(Array.from((await decodePng(withIdat(zlibOf([0, 1, 2, 3]), [1, 2, 3, 4]))).pixels)).toEqual([1, 2, 3, 255]);
  });

  test.each([
    ['bytes after the zlib stream', withIdat(zlibOf([0, 1, 2, 3]), [1, 2, 3, 4])],
    ['no checksum', withIdat(zlibOf([0, 1, 2, 3]).subarray(0, -4))],
    ['more than the image needs', withIdat(zlibOf([0, 1, 2, 3, 9, 9, 9, 9]))],
    ['a stored block holding more than the image needs', withIdat(zlib.deflateSync(Uint8Array.from([0, 1, 2, 3, 9, 9, 9, 9]), { level: 0 }))],
    ['a stream with no final block', withIdat(zlib.deflateSync(Uint8Array.from([0, 1, 2, 3]), { finishFlush: zlib.constants.Z_SYNC_FLUSH }))]
  ])('when the browser refuses them, fflate inflates %s, and the console says why', async (_, bytes) => {
    refusing();
    const log = debug();

    expect(Array.from((await decodePng(bytes)).pixels)).toEqual([1, 2, 3, 255]);
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'PNG: inflated the image data with fflate, as the browser refused it: Junk found after end of compressed data.'
    );
  });

  test('image data split over several IDAT chunks, the zlib header too, inflates whole through fflate', async () => {
    const [width, height] = [16, 8];
    const raw = Uint8Array.from({ length: width * height * 4 }, (_, i) => (i * 97 + (i >> 3) * 31) & 255);
    const rows = Array.from({ length: height }, (_, y) => [0, ...raw.subarray(y * width * 4, (y + 1) * width * 4)]).flat();
    const stream = Buffer.concat([zlibOf(rows), Buffer.from([1, 2, 3, 4])]);
    const cuts = [0, 1, 3, stream.length >> 1, stream.length];
    const bytes = replaceChunk(png({ width, height, colorType: 6 }, rows), 'IDAT',
      ...cuts.slice(1).map((end, i) => pngChunk('IDAT', stream.subarray(cuts[i], end))));

    refusing();
    debug();

    expect(Array.from((await decodePng(bytes)).pixels)).toEqual(Array.from(raw));
  });

  test.each([
    ['empty', [], "Junk found after end of compressed data. (fflate: not a zlib header)"],
    ['one byte', [0x78], 'not a zlib header'],
    ['only the zlib header', [0x78, 0x9c], 'fflate: 0 of 4 bytes'],
    ['a stream cut short', zlibOf([0, 1, 2, 3, 9, 9, 9, 9]).subarray(0, 4), 'fflate: 1 of 4 bytes'],
    ['a method other than deflate', [0x79, 0x18, 0x63, 0, 0], 'not a zlib header'],
    ['a window over 32KB', [0x88, 0x98, 0x63, 0, 0], 'not a zlib header'],
    ['a header that fails its check', [0x78, 0x9d, 0x63, 0, 0], 'not a zlib header'],
    ['a preset dictionary', [0x78, 0xbb, 0, 0, 0, 0, 0x63, 0, 0], 'needs a preset dictionary'],
    ['data that will not inflate', [0x78, 0x9c, 0xff, 0xff, 0xff, 0xff], 'fflate: invalid block type']
  ])('when neither will inflate %s, it is refused, giving both reasons', async (_, data, reason) => {
    refusing();

    const error = await decodePng(withIdat(data)).catch(e => e);

    expect(error.message).toMatch(/^The PNG's image data won't inflate: Junk found after end of compressed data\. \(fflate: .+\)$/);
    expect(error.message).toContain(reason);
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  test.each([[[]], [[0x78]], [[0x78, 0x9c]]])("image data of %j is refused by Node's DecompressionStream too", async data => {
    await expect(decodePng(withIdat(data))).rejects.toThrow("The PNG's image data won't inflate: ");
  });
});

test('chunks after the image data are not read, nor bytes after IEND, as browsers do', async () => {
  const truncated = [...pngChunk('tEXt', [0x41, 0, 0x42, 0x43])].slice(0, 9);
  const rgb = png({ width: 1, height: 1, colorType: 2 }, [0, 1, 2, 3]);
  const withBrokenText = new Uint8Array([...rgb.subarray(0, rgb.length - 12), ...truncated]);

  expect(Array.from((await decodePng(withBrokenText)).pixels)).toEqual([1, 2, 3, 255]);
  expect(Array.from((await decodePng(png({ width: 1, height: 1, colorType: 2 }, [0, 1, 2, 3], [], new Array(64).fill(0xab)))).pixels))
    .toEqual([1, 2, 3, 255]);
});

test('inflated data past what the image needs is ignored', async () => {
  const { pixels } = await decodePng(png({ width: 1, height: 1, colorType: 2 }, [0, 1, 2, 3, 9, 9, 9, 9]));

  expect(Array.from(pixels)).toEqual([1, 2, 3, 255]);
});

describe('readPngHeader', () => {
  test.each([
    ['rgb8', false, 2], ['rgba8', true, 6], ['ga8', true, 4], ['g8', false, 0], ['gt8', true, 0], ['rgbt8', true, 2],
    ['p4', false, 3], ['pt8', true, 3], ['pa8', true, 3]
  ])('%s has alpha: %s', async (name, alpha, colorType) => {
    expect(await readPngHeader(new Blob([await file(`${name}.png`)]))).toEqual({ alpha, colorType, colorChunks: [] });
  });

  test('a JPEG has no alpha; anything else that is not a PNG might', async () => {
    expect(await readPngHeader(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]))).toEqual({ alpha: false, colorChunks: [] });
    expect(await readPngHeader(new Blob(['RIFF....WEBP']))).toEqual({ alpha: true, colorChunks: [] });
  });

  test('keeps the colour chunks, cHRM and cICP too, reading past the first 64KB when an ICC profile is that big', async () => {
    const profile = new Uint8Array(100 * 1024).map((_, i) => i);
    const bytes = png({ width: 1, height: 1, colorType: 2 }, [0, 0, 0, 0], [
      pngChunk('gAMA', [0, 0, 0xb1, 0x8f]), pngChunk('cHRM', new Array(32).fill(1)), pngChunk('cICP', [12, 13, 0, 1]),
      pngChunk('tEXt', [0x41, 0, 0x42]), pngChunk('iCCP', profile)
    ]);

    const header = await readPngHeader(new Blob([bytes]));

    expect(header.colorChunks.map(({ type, data }) => [type, data.length]))
      .toEqual([['gAMA', 4], ['cHRM', 32], ['cICP', 4], ['iCCP', profile.length]]);
    expect(header.colorChunks[3].data).toEqual(profile);
  });

  test('colour chunks after PLTE are out of place and ignored, as libpng does', async () => {
    const bytes = png({ width: 1, height: 1, colorType: 2 }, [0, 0, 0, 0], [
      pngChunk('sRGB', [0]), pngChunk('PLTE', [1, 2, 3]), pngChunk('gAMA', [0, 1, 0x86, 0xa0])
    ]);

    expect((await readPngHeader(new Blob([bytes]))).colorChunks.map(({ type }) => type)).toEqual(['sRGB']);
  });

  test.each([
    ['no image data', bytes => bytes.subarray(0, 33), 'no image data'],
    ['no IHDR', bytes => replaceChunk(bytes, 'IHDR'), 'no IHDR']
  ])('a PNG with %s is refused', async (_, edit, message) => {
    await expect(readPngHeader(new Blob([edit(await file('rgb8.png'))]))).rejects.toThrow(message);
  });
});

describe('an IHDR of the wrong length', () => {
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const of = (...chunks) => replaceChunk(png({ width: 1, height: 1, colorType: 2 }, [0, 1, 2, 3]), 'IHDR', ...chunks);

  test.each([
    ['decodePng', bytes => decodePng(bytes)],
    ['readPngHeader', bytes => readPngHeader(new Blob([bytes]))]
  ])('is refused by %s, saying so, even with a good one after it', async (_, read) => {
    await expect(read(of(pngChunk('IHDR', ihdr.subarray(0, 12))))).rejects.toThrow("The PNG's IHDR chunk is 12 bytes, not 13");
    await expect(read(of(pngChunk('IHDR', [1, 2, 3]), pngChunk('IHDR', ihdr)))).rejects.toThrow("The PNG's IHDR chunk is 3 bytes, not 13");
  });
});

test.each([
  ['decodePng', bytes => decodePng(bytes)],
  ['readPngHeader', bytes => readPngHeader(new Blob([bytes]))]
])('a second PLTE is refused by %s, as libpng and the browsers refuse it', async (_, read) => {
  const bytes = png({ width: 1, height: 1, colorType: 3 }, [0, 0], [pngChunk('PLTE', [1, 2, 3]), pngChunk('PLTE', [4, 5, 6])]);

  await expect(read(bytes)).rejects.toThrow('The PNG has a second PLTE chunk');
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
    await expect(decodePng(replaceChunk(await file('rgb8.png'), type))).rejects.toThrow(message);
  });

  test('more pixels than it decodes, before allocating them', async () => {
    await expect(decodePng(png({ width: 100000, height: 100000, colorType: 6 }, [0]))).rejects.toThrow('100000x100000, more than the');
  });

  test('one row past 4096x4096, while 4096x4096 itself gets as far as inflating', async () => {
    expect(MAX_PIXELS).toBe(4096 * 4096);
    await expect(decodePng(png({ width: 4096, height: 4096, colorType: 0 }, [0]))).rejects.toThrow('too short');
    await expect(decodePng(png({ width: 4096, height: 4097, colorType: 0 }, [0]))).rejects.toThrow('4096x4097, more than the');
  });

  test('image data one byte short', async () => {
    await expect(decodePng(png({ width: 1, height: 1, colorType: 2 }, [0, 1, 2]))).rejects.toThrow('too short');
  });

  test('a chunk that runs past the end', async () => {
    const bytes = await file('rgb8.png');

    await expect(decodePng(bytes.subarray(0, bytes.length - 20))).rejects.toThrow('runs past its end');
  });

  test('image data that inflates short', async () => {
    await expect(decodePng(png({ width: 13, height: 9, colorType: 2 }, [0, 0, 0]))).rejects.toThrow('too short');
  });

  test('image data that will not inflate, saying so', async () => {
    const bytes = png({ width: 1, height: 1, colorType: 2 }, [0, 1, 2, 3]);
    const corrupt = replaceChunk(bytes, 'IDAT', pngChunk('IDAT', [0x78, 0x9c, 0xff, 0xff, 0xff, 0xff]));

    await expect(decodePng(corrupt)).rejects.toThrow(/^The PNG's image data won't inflate: \S/);
  });

  test('a palette colour type with no palette', async () => {
    await expect(decodePng(replaceChunk(await file('p4.png'), 'PLTE'))).rejects.toThrow('no palette');
  });

  test('a pixel past the end of the palette', async () => {
    const bytes = await file('p4.png');
    const { at, length } = findChunk(bytes, 'PLTE');

    expect(length).toBeGreaterThan(3);
    await expect(decodePng(replaceChunk(bytes, 'PLTE', pngChunk('PLTE', bytes.subarray(at + 8, at + 11)))))
      .rejects.toThrow('of a palette of 1');
  });

  test('a row with an unknown filter', async () => {
    await expect(decodePng(png({ width: 2, height: 1, colorType: 0 }, [5, 0, 0]))).rejects.toThrow('unknown filter, 5');
  });
});

test('isPng', () => {
  expect(isPng(new Uint8Array([...SIGNATURE, 0]))).toBe(true);
  expect(isPng(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
});

function findChunk(bytes, type) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);

  for (let at = 8; at < bytes.length; at += 12 + view.getUint32(at)) {
    if (String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === type) {
      return { at, length: view.getUint32(at) };
    }
  }

  throw new Error(`No ${type}`);
}
