/**
 * The APNG encoder: apngFrame.js's frames, compressed by Node's own CompressionStream and read back
 * with probeApng, and apng.js over fake workers that run the same encodeApngFrame. The pool is
 * pool.js, shared with GIF, and test/ugoiraGifEncoder.spec.js covers its aborts and failures. Node has no Worker,
 * createImageBitmap or OffscreenCanvas: ugoiraApngWorker.spec.js stubs them for apng.worker.js, and
 * the e2e tests run it for real.
 */
import zlib from 'node:zlib';
import { FALLBACK_DELAY } from '@/options_page/modules/UgoiraEncoders/delay';
import {
  apngDelay, changedArea, crc32, encodeApngFrame, filterRows, muxApng
} from '@/options_page/modules/UgoiraEncoders/apngFrame';
import { encodeApng } from '@/options_page/modules/UgoiraEncoders/apng';
import { pixelAt, pngChunk, probeApng } from './helpers/probeApng.mjs';

/** A frame of one colour. */
const solid = (width, height, rgba) => {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    pixels.set(rgba, i * 4);
  }

  return pixels;
};

/** A frame of seeded noise over gradients, so rows pick different filters; alpha varies when `alpha`. */
const busy = (width, height, { seed = 1, alpha = false } = {}) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const kind = y % 4;

      pixels.set([
        kind === 0 ? x * 9 : kind === 1 ? y * 13 : kind === 2 ? random() : (x * y) & 255,
        (x * 7 + y * 3) & 255,
        kind === 3 ? random() : 200 - x,
        alpha ? random() : 255
      ], at);
    }
  }

  return pixels;
};

/** Encodes whole frames the way apng.js does, then muxes them. */
const encodeFrames = async (images, { width, height, alpha = false, delays = images.map(() => 100) }) => {
  const frames = [];

  for (const [i, pixels] of images.entries()) {
    const frame = await encodeApngFrame({ pixels, previous: images[i - 1] ?? null, width, height, alpha });
    frames.push({ ...frame, delay: delays[i] });
  }

  return muxApng({ width, height, alpha, frames });
};

const rgbOf = pixels => Array.from(pixels).filter((_, i) => i % 4 !== 3);

describe('apngDelay', () => {
  test.each([
    ['ms as thousandths of a second', 100, [100, 1000]],
    ['a fractional delay to the nearest ms', 33.4, [33, 1000]],
    ['10ms at 20ms, which browsers play as it is', 10, [20, 1000]],
    ['no delay at the fallback', undefined, [FALLBACK_DELAY, 1000]],
    ['0 at the fallback', 0, [FALLBACK_DELAY, 1000]],
    ['a negative delay at the fallback', -40, [FALLBACK_DELAY, 1000]],
    ['NaN at the fallback', NaN, [FALLBACK_DELAY, 1000]],
    ['65.535s, the most a 16-bit count of ms holds', 65535, [65535, 1000]],
    ['a longer delay in hundredths', 65536, [6554, 100]],
    ['longer still in tenths', 700000, [7000, 10]],
    ['beyond 65535s at the cap', 1e9, [65535, 1]]
  ])('gives %s', (_, delay, expected) => {
    expect(apngDelay(delay)).toEqual(expected);
  });
});

describe('changedArea', () => {
  const base = () => busy(8, 6);

  test('is the one pixel that changed', () => {
    const next = base();
    next.set([1, 2, 3, 255], (4 * 8 + 5) * 4);

    expect(changedArea(next, base(), 8, 6)).toEqual({ x: 5, y: 4, width: 1, height: 1 });
  });

  test('spans every change, the leftmost and rightmost on different rows', () => {
    const next = base();
    next[(1 * 8 + 6) * 4] ^= 1;
    next[(3 * 8 + 2) * 4 + 1] ^= 1;
    next[(2 * 8 + 4) * 4 + 2] ^= 1;

    expect(changedArea(next, base(), 8, 6)).toEqual({ x: 2, y: 1, width: 5, height: 3 });
  });

  test('counts a change of alpha alone', () => {
    const next = base();
    next[(5 * 8 + 0) * 4 + 3] = 7;

    expect(changedArea(next, base(), 8, 6)).toEqual({ x: 0, y: 5, width: 1, height: 1 });
  });

  test('a frame that did not change gets its top-left pixel', () => {
    expect(changedArea(base(), base(), 8, 6)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  test('reads pixels that start partway into their buffer', () => {
    const buffer = new Uint8ClampedArray(8 + 8 * 6 * 4);
    const next = buffer.subarray(8);
    next.set(base());
    next[(2 * 8 + 3) * 4] ^= 1;

    expect(changedArea(next, base(), 8, 6)).toEqual({ x: 3, y: 2, width: 1, height: 1 });
  });
});

describe('filterRows', () => {
  /** Grey pixels, one row per list. */
  const greys = rows => {
    const pixels = new Uint8ClampedArray(rows.length * rows[0].length * 4);
    rows.flat().forEach((value, i) => pixels.set([value, value, value, 255], i * 4));
    return pixels;
  };
  const RAMP = [100, 150, 175, 187, 193, 196, 198, 199];
  const ROWS = [
    [128, 128, 128, 128, 128, 128, 128, 128], // flat: sub
    [2, 254, 2, 254, 2, 254, 2, 254], // small signed bytes, far from every neighbour: none
    [200, 200, 200, 200, 200, 200, 200, 200], // flat: sub
    RAMP, // each the mean of its left neighbour and the 200 above: average
    RAMP, // the row above again: up
    [10, 10, 10, 10, 90, 90, 90, 90],
    [10, 10, 90, 90, 90, 90, 90, 90] // the edge above, moved left: paeth
  ];

  test("picks each row's filter by the smallest sum of signed bytes, as libpng does", () => {
    const rows = filterRows(greys(ROWS), 8, { x: 0, y: 0, width: 8, height: ROWS.length }, false);

    expect(rows).toHaveLength(ROWS.length * (1 + 8 * 3));
    expect(ROWS.map((_, row) => rows[row * (1 + 8 * 3)])).toEqual([1, 0, 1, 3, 2, 1, 4]);
  });

  test('every filter reads back exactly, with and without alpha', async () => {
    for (const alpha of [false, true]) {
      const pixels = greys(ROWS);
      const apng = probeApng(await encodeFrames([pixels], { width: 8, height: ROWS.length, alpha }));

      expect(Array.from(apng.frames[0].rgba)).toEqual(Array.from(pixels));
    }
  });

  test('filters only the area asked for', () => {
    const pixels = greys(ROWS);
    const rows = filterRows(pixels, 8, { x: 2, y: 5, width: 3, height: 2 }, false);

    // Row 5 from x 2 is 10, 10, 90; its first pixel has nothing to its left or above within the area.
    expect(rows).toHaveLength(2 * (1 + 3 * 3));
    expect(rows[0]).toBe(1);
    expect(Array.from(rows.subarray(1, 10))).toEqual([10, 10, 10, 0, 0, 0, 80, 80, 80]);
  });
});

describe('crc32', () => {
  test("is PNG's CRC", () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });
});

describe('encodeApngFrame and muxApng', () => {
  test('make a looping APNG whose frames read back exactly, each with its delay', async () => {
    const images = [busy(23, 17, { seed: 1 }), busy(23, 17, { seed: 2 }), busy(23, 17, { seed: 3 })];
    const apng = probeApng(await encodeFrames(images, { width: 23, height: 17, delays: [40, 1000, 65536] }));

    expect(apng).toMatchObject({ width: 23, height: 17, colorType: 2, plays: 0 });
    expect(apng.chunks).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'fcTL', 'fdAT', 'IEND']);
    expect(apng.frames.map(frame => frame.delay)).toEqual([40, 1000, 65540]);
    apng.frames.forEach((frame, i) => expect(rgbOf(frame.rgba)).toEqual(rgbOf(images[i])));
  });

  test('without alpha, write RGB and read back opaque', async () => {
    const apng = probeApng(await encodeFrames([busy(5, 4, { alpha: true })], { width: 5, height: 4 }));

    expect(apng.colorType).toBe(2);
    expect(apng.frames[0].rgba.filter((_, i) => i % 4 === 3).every(value => value === 255)).toBe(true);
  });

  test('with alpha, keep it', async () => {
    const images = [busy(9, 7, { alpha: true, seed: 4 }), busy(9, 7, { alpha: true, seed: 5 })];
    const apng = probeApng(await encodeFrames(images, { width: 9, height: 7, alpha: true }));

    expect(apng.colorType).toBe(6);
    apng.frames.forEach((frame, i) => expect(Array.from(frame.rgba)).toEqual(Array.from(images[i])));
  });

  test('a frame after the first holds only the area that changed, and draws over the frame before', async () => {
    const first = solid(10, 8, [10, 20, 30, 255]);
    const second = first.slice();
    second.set([200, 0, 0, 255], (3 * 10 + 4) * 4);
    second.set([0, 200, 0, 255], (5 * 10 + 7) * 4);
    const third = second.slice();

    const apng = probeApng(await encodeFrames([first, second, third], { width: 10, height: 8 }));

    expect(apng.frames.map(({ x, y, width, height }) => [x, y, width, height]))
      .toEqual([[0, 0, 10, 8], [4, 3, 4, 3], [0, 0, 1, 1]]);
    expect(pixelAt(apng.frames[1], 10, 4, 3)).toEqual([200, 0, 0, 255]);
    expect(pixelAt(apng.frames[1], 10, 7, 5)).toEqual([0, 200, 0, 255]);
    expect(pixelAt(apng.frames[1], 10, 5, 4)).toEqual([10, 20, 30, 255]);
    expect(apng.frames[2].rgba).toEqual(apng.frames[1].rgba);
  });

  test('a single frame is an APNG of one frame', async () => {
    const apng = probeApng(await encodeFrames([solid(3, 2, [1, 2, 3, 255])], { width: 3, height: 2 }));

    expect(apng.chunks).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'IEND']);
  });
});

describe('encodeApng', () => {
  /** Runs apng.worker.js's encoding on { pixels, width, height, type } images. */
  class FakeWorker {
    static created = [];
    posted = [];
    terminated = false;
    onmessage = null;
    onerror = null;

    constructor() {
      FakeWorker.created.push(this);
    }

    postMessage(message) {
      this.posted.push(message);
      const { index, image, previous, alpha } = message;
      const sameSize = previous?.width === image.width && previous?.height === image.height;

      encodeApngFrame({
        pixels: image.pixels, previous: sameSize ? previous.pixels : null, width: image.width, height: image.height, alpha
      }).then(frame => !this.terminated && this.onmessage({
        data: { index, result: { ...frame, frameWidth: image.width, frameHeight: image.height } }
      }));
    }

    terminate() {
      this.terminated = true;
    }
  }

  /** A JPEG's first bytes, or a PNG's through its first IDAT: all apng.js reads of a frame. */
  const head = (colorType, chunks) => colorType === 'jpeg' ?
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]) :
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, colorType, 0, 0, 0]),
      ...chunks,
      pngChunk('IDAT', [])
    ]);
  /** A frame Blob that the fake worker reads as `pixels`; `colorType` 'jpeg' or a PNG colour type. */
  const image = (pixels, width, height, colorType = 'jpeg', chunks = [], type = '') =>
    Object.assign(new Blob([head(colorType, chunks)], { type }), { pixels, width, height });
  const encode = async images => {
    const { data } = await encodeApng({ frames: images.map(img => ({ image: img, delay: 100 })), createWorker });
    const posted = FakeWorker.created.flatMap(worker => worker.posted);

    return { data, apng: probeApng(data), exact: [...new Set(posted.map(message => message.exact))] };
  };
  const createWorker = () => new FakeWorker();

  beforeEach(() => {
    FakeWorker.created = [];
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('muxes each frame in its place, sending each worker its frame and the one before', async () => {
    const images = [1, 2, 3, 4].map(seed => image(busy(12, 9, { seed }), 12, 9));
    const frames = images.map((img, i) => ({ image: img, delay: 50 * (i + 1) }));
    const progresses = [];

    const result = await encodeApng({ frames, createWorker, onProgress: progress => progresses.push(progress) });

    expect(result).toMatchObject({ mimeType: 'image/apng', extension: 'apng' });
    const apng = probeApng(result.data);
    expect(apng).toMatchObject({ width: 12, height: 9, colorType: 2, plays: 0 });
    expect(apng.frames.map(frame => frame.delay)).toEqual([50, 100, 150, 200]);
    apng.frames.forEach((frame, i) => expect(rgbOf(frame.rgba)).toEqual(rgbOf(images[i].pixels)));
    expect(progresses).toEqual([0.25, 0.5, 0.75, 1]);

    const posted = FakeWorker.created.flatMap(worker => worker.posted).sort((a, b) => a.index - b.index);
    posted.forEach(({ previous }, i) => expect(previous).toBe(i ? images[i - 1] : null));
    expect(posted.every(({ alpha }) => alpha === false)).toBe(true);
    expect(FakeWorker.created.every(worker => worker.terminated)).toBe(true);
  });

  test('RGB PNG frames make an RGB APNG, whatever the ugoira says its type is', async () => {
    const images = [1, 2].map(seed => image(busy(4, 3, { seed }), 4, 3, 2, [], 'image/png'));

    expect((await encode(images)).apng.colorType).toBe(2);
  });

  test.each([
    ['an alpha channel', 6, []],
    ['grey and alpha', 4, []],
    ['tRNS', 2, [pngChunk('tRNS', [0, 1, 0, 2, 0, 3])]],
    ['a palette with tRNS', 3, [pngChunk('PLTE', [1, 2, 3]), pngChunk('tRNS', [0])]]
  ])('one PNG frame with %s makes the whole APNG RGBA', async (_, colorType, chunks) => {
    const pixels = busy(4, 3, { alpha: true });
    const images = [image(busy(4, 3), 4, 3, 2), image(pixels, 4, 3, colorType, chunks)];
    const apng = probeApng((await encodeApng({ frames: images.map(img => ({ image: img, delay: 100 })), createWorker })).data);

    expect(apng.colorType).toBe(6);
    expect(FakeWorker.created.flatMap(worker => worker.posted).every(({ alpha }) => alpha)).toBe(true);
    expect(Array.from(apng.frames[1].rgba)).toEqual(Array.from(pixels));
  });

  const gamma = pngChunk('gAMA', [0, 0, 0xb1, 0x8f]);
  const chrm = pngChunk('cHRM', [0, 0, 0x7a, 0x26, 0, 0, 0x80, 0x84, 0, 0, 0xfa, 0, 0, 0, 0x80, 0xe8, 0, 0, 0x75, 0x30, 0, 0, 0xea, 0x60, 0, 0, 0x3a, 0x98, 0, 0, 0x17, 0x70]);
  const srgb = pngChunk('sRGB', [0]);
  const profile = pngChunk('iCCP', [0x70, 0, 0, 0x78, 0x9c, 3, 0, 0, 0, 0, 1]);
  const colorChunksOf = apng => apng.chunks.filter(type => ['cHRM', 'gAMA', 'iCCP', 'sRGB', 'cICP'].includes(type));

  test('carries colour chunks every frame has, after IHDR, keeping the PNG frames exact', async () => {
    const text = pngChunk('tEXt', [0x41, 0, 0x42]);
    const { data, apng, exact } = await encode([image(busy(4, 3), 4, 3, 2, [gamma, chrm, text]), image(busy(4, 3), 4, 3, 6, [gamma, chrm])]);

    expect(apng.chunks.slice(0, 4)).toEqual(['IHDR', 'gAMA', 'cHRM', 'acTL']);
    expect(Buffer.from(data).includes(Buffer.concat([gamma, chrm]))).toBe(true);
    expect(exact).toEqual([true]);
  });

  test('grey frames sharing a gAMA stay exact and carry it', async () => {
    const { apng, exact } = await encode([image(busy(4, 3), 4, 3, 0, [gamma]), image(busy(4, 3), 4, 3, 4, [gamma])]);

    expect(colorChunksOf(apng)).toEqual(['gAMA']);
    expect(exact).toEqual([true]);
  });

  test.each([
    ['frames tagged differently', [[2, [gamma]], [2, [chrm]]], "frame 2's colour chunks differ from frame 1's"],
    ['the same chunk with different values', [[2, [gamma]], [2, [pngChunk('gAMA', [0, 1, 0x86, 0xa0])]]], "frame 2's colour chunks differ from frame 1's"],
    ['a tagged frame beside an untagged one', [[2, []], [2, [gamma]]], "frame 2's colour chunks differ from frame 1's"],
    ['a JPEG beside a tagged PNG', [['jpeg', []], [2, [gamma]]], "frame 2's colour chunks differ from frame 1's"],
    ['an sRGB frame beside a gAMA one', [[2, [srgb, gamma]], [2, [gamma]]], "frame 2's colour chunks differ from frame 1's"],
    ["an ICC profile that is the start of frame 1's", [[2, [profile]], [2, [pngChunk('iCCP', [0x70, 0, 0, 0x78, 0x9c, 3])]]], "frame 2's colour chunks differ from frame 1's"],
    ['a grey frame with an ICC profile', [[0, [profile]], [0, [profile]]], 'frame 1 is grey with an ICC profile'],
    ['a grey-and-alpha frame with an ICC profile', [[2, []], [4, [profile]]], 'frame 2 is grey with an ICC profile'],
    ['cICP', [[2, [pngChunk('cICP', [12, 13, 0, 1])]], [2, [pngChunk('cICP', [12, 13, 0, 1])]]], 'frame 1 has a cICP chunk'],
    ['cICP beside sRGB', [[2, []], [2, [srgb, pngChunk('cICP', [1, 13, 0, 1])]]], 'frame 2 has a cICP chunk']
  ])('with %s, the browser converts every frame to sRGB, nothing is carried, and the console says why', async (_, kinds, reason) => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { apng, exact } = await encode(kinds.map(([colorType, chunks]) => image(busy(4, 3), 4, 3, colorType, chunks)));

    expect(apng.chunks).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND']);
    expect(exact).toEqual([false]);
    expect(info).toHaveBeenCalledExactlyOnceWith(`APNG: converting every frame to sRGB, because ${reason}`);
  });

  test('untagged PNG frames beside JPEG frames stay exact, saying nothing', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    expect((await encode([image(busy(4, 3), 4, 3), image(busy(4, 3), 4, 3, 6)])).exact).toEqual([true]);
    expect(info).not.toHaveBeenCalled();
  });

  test('sRGB frames count as untagged, gAMA and cHRM too, so beside JPEG and untagged frames they stay exact and carry only sRGB', async () => {
    const intent = pngChunk('sRGB', [1]);
    const { data, apng, exact } = await encode([
      image(busy(4, 3), 4, 3), image(busy(4, 3), 4, 3, 6, [intent, gamma, chrm]), image(busy(4, 3), 4, 3, 2, [srgb]), image(busy(4, 3), 4, 3, 2)
    ]);

    expect(colorChunksOf(apng)).toEqual(['sRGB']);
    expect(Buffer.from(data).includes(intent)).toBe(true);
    expect(exact).toEqual([true]);
  });

  test('a tagged first frame carries only sRGB when every frame says sRGB', async () => {
    const { apng, exact } = await encode([image(busy(4, 3), 4, 3, 2, [srgb, gamma]), image(busy(4, 3), 4, 3, 2, [srgb])]);

    expect(colorChunksOf(apng)).toEqual(['sRGB']);
    expect(exact).toEqual([true]);
  });

  test.each([
    ['two bytes long', [0, 0]],
    ['an unknown intent', [4]]
  ])('an sRGB chunk %s does not count, as libpng ignores it, so the gAMA beside it does', async (_, data) => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { exact } = await encode([image(busy(4, 3), 4, 3, 2, [pngChunk('sRGB', data), gamma]), image(busy(4, 3), 4, 3, 2, [srgb])]);

    expect(exact).toEqual([false]);
    expect(info).toHaveBeenCalledExactlyOnceWith("APNG: converting every frame to sRGB, because frame 2's colour chunks differ from frame 1's");
  });

  test('an ICC profile overrides sRGB, so frames with both carry both', async () => {
    const { apng, exact } = await encode([image(busy(4, 3), 4, 3, 2, [profile, srgb]), image(busy(4, 3), 4, 3, 2, [profile, srgb])]);

    expect(colorChunksOf(apng)).toEqual(['iCCP', 'sRGB']);
    expect(exact).toEqual([true]);
  });

  test('a frame whose header is broken rejects, naming APNG and the frame, with png.js\'s error as the cause', async () => {
    const broken = Object.assign(new Blob([head(2, []).subarray(0, 20)]), { pixels: busy(4, 3), width: 4, height: 3 });
    const error = await encodeApng({ frames: [image(busy(4, 3), 4, 3, 2), broken].map(img => ({ image: img, delay: 100 })), createWorker })
      .catch(e => e);

    expect(error.message).toMatch(/^Could not read APNG frame 2: The PNG/);
    expect(error.message).toBe(`Could not read APNG frame 2: ${error.cause.message}`);
  });

  test('JPEG frames carry no colour chunks', async () => {
    const data = (await encodeApng({ frames: [{ image: image(busy(4, 3), 4, 3), delay: 100 }], createWorker })).data;

    expect(probeApng(data).chunks).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'IEND']);
  });

  test('a frame of another size rejects, naming it', async () => {
    const frames = [image(solid(4, 3, [0, 0, 0, 255]), 4, 3), image(solid(4, 3, [9, 9, 9, 255]), 4, 3), image(solid(5, 3, [0, 0, 0, 255]), 5, 3)]
      .map(img => ({ image: img, delay: 100 }));

    await expect(encodeApng({ frames, createWorker })).rejects.toThrow("APNG frame 3 is 5x3, not the first frame's 4x3");
  });

  test('a frame that fails rejects naming APNG and the frame', async () => {
    const failing = () => {
      const worker = new FakeWorker();
      worker.postMessage = ({ index }) => setTimeout(() => worker.onmessage({ data: { index, error: 'EncodingError: no' } }));
      return worker;
    };

    await expect(encodeApng({ frames: [{ image: image(solid(1, 1, [0, 0, 0, 255]), 1, 1), delay: 1 }], createWorker: failing }))
      .rejects.toThrow('Could not encode APNG frame 1: EncodingError: no');
  });

  test('no frames rejects, giving no colour reason', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    await expect(encodeApng({ frames: [], createWorker })).rejects.toThrow('The ugoira has no frames to encode');
    expect(info).not.toHaveBeenCalled();
  });
});

describe('probeApng refuses', () => {
  const twoFrames = async second => {
    const first = await encodeApngFrame({ pixels: solid(2, 2, [1, 2, 3, 255]), previous: null, width: 2, height: 2, alpha: false });

    return muxApng({ width: 2, height: 2, alpha: false, frames: [{ ...first, delay: 100 }, { ...first, ...second, delay: 100 }] });
  };

  test.each([[10, 'compression 1'], [11, 'filter 1']])('an IHDR with byte %i set', async (byte, message) => {
    const apng = Buffer.from(await twoFrames({}));

    apng[16 + byte] = 1;
    apng.writeUInt32BE(zlib.crc32(apng.subarray(12, 29)), 29);

    expect(() => probeApng(apng)).toThrow(message);
  });

  test('an empty frame', async () => {
    const apng = await twoFrames({ width: 0, height: 0 });

    expect(() => probeApng(apng)).toThrow('Frame 2 is empty');
  });
});
