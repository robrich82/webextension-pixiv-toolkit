/**
 * apng.worker.js over stubbed worker globals: Node has no createImageBitmap, OffscreenCanvas or
 * reportError. The e2e tests run it in the browsers.
 */
import zlib from 'node:zlib';
import { encodeApngFrame, muxApng } from '@/options_page/modules/UgoiraEncoders/apngFrame';
import { pngChunk, probeApng } from './helpers/probeApng.mjs';

/** A canvas that logs the drawing calls and reads back the pixels of the image drawn on it. */
class FakeCanvas {
  static log = [];

  constructor(width, height) {
    FakeCanvas.log.push(['canvas', width, height]);
  }

  getContext(...args) {
    const log = FakeCanvas.log;
    let drawn;

    log.push(['getContext', ...args]);

    return {
      drawImage(image, ...at) {
        drawn = image;
        log.push(['drawImage', image.name, ...at]);
      },
      getImageData: () => ({ data: drawn.pixels.slice() })
    };
  }
}

/** A decoded image: `width` x `height` of one RGBA colour. */
const bitmap = (name, width, height, rgba) => {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    pixels.set(rgba, i * 4);
  }

  return { name, width, height, pixels, close: vi.fn() };
};

let worker;
let bitmaps;

beforeEach(async () => {
  FakeCanvas.log = [];
  bitmaps = new Map();
  worker = { postMessage: vi.fn() };
  vi.stubGlobal('self', worker);
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  vi.stubGlobal('createImageBitmap', vi.fn(async image => bitmaps.get(image)));
  vi.stubGlobal('reportError', vi.fn());
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.resetModules();
  await import('@/options_page/modules/UgoiraEncoders/apng.worker.js');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A frame Blob that createImageBitmap decodes to `decoded`. */
const frame = decoded => {
  const image = new Blob([decoded.name]);
  bitmaps.set(image, decoded);
  return image;
};

test('the first frame is the whole image, and its buffer is handed over', async () => {
  const first = bitmap('first', 3, 2, [10, 20, 30, 255]);
  const image = frame(first);

  await worker.onmessage({ data: { index: 0, image, previous: null, alpha: false } });

  expect(createImageBitmap).toHaveBeenCalledWith(image, { colorSpaceConversion: 'default' });
  expect(FakeCanvas.log).toEqual([
    ['canvas', 3, 2],
    ['getContext', '2d', { willReadFrequently: true }],
    ['drawImage', 'first', 0, 0]
  ]);
  expect(first.close).toHaveBeenCalled();

  const [[message, transfer]] = worker.postMessage.mock.calls;
  expect(message).toMatchObject({ index: 0, result: { x: 0, y: 0, width: 3, height: 2, frameWidth: 3, frameHeight: 2 } });
  expect(transfer).toEqual([message.result.data.buffer]);

  const apng = probeApng(muxApng({ width: 3, height: 2, alpha: false, frames: [{ ...message.result, delay: 40 }] }));
  expect(Array.from(apng.frames[0].rgba.subarray(0, 4))).toEqual([10, 20, 30, 255]);
});

test('a later frame decodes the one before it too, and holds only what changed', async () => {
  const before = bitmap('before', 4, 3, [0, 0, 0, 255]);
  const now = bitmap('now', 4, 3, [0, 0, 0, 255]);
  now.pixels.set([9, 9, 9, 255], (1 * 4 + 2) * 4);

  await worker.onmessage({ data: { index: 5, image: frame(now), previous: frame(before), alpha: true } });

  expect(FakeCanvas.log.filter(([call]) => call === 'drawImage')).toEqual([['drawImage', 'now', 0, 0], ['drawImage', 'before', 0, 0]]);
  expect(before.close).toHaveBeenCalled();
  const [[{ index, result }]] = worker.postMessage.mock.calls;
  expect(index).toBe(5);
  expect(result).toMatchObject({ x: 2, y: 1, width: 1, height: 1, frameWidth: 4, frameHeight: 3 });
  // One row: its filter byte, then the pixel as RGBA.
  expect(zlib.inflateSync(result.data).subarray(1)).toEqual(Buffer.from([9, 9, 9, 255]));
});

test('without alpha a frame is stored as RGB', async () => {
  const now = bitmap('now', 1, 1, [9, 8, 7, 255]);

  await worker.onmessage({ data: { index: 0, image: frame(now), previous: null, alpha: false } });

  const [[{ result }]] = worker.postMessage.mock.calls;
  expect(zlib.inflateSync(result.data).subarray(1)).toEqual(Buffer.from([9, 8, 7]));
});

test.each([[5, 3], [4, 2]])('a frame whose previous is %ix%i is encoded whole, for the page to refuse', async (width, height) => {
  const now = bitmap('now', 4, 3, [1, 1, 1, 255]);

  await worker.onmessage({ data: { index: 1, image: frame(now), previous: frame(bitmap('before', width, height, [1, 1, 1, 255])), alpha: false } });

  const [[{ result }]] = worker.postMessage.mock.calls;
  expect(result).toMatchObject({ x: 0, y: 0, width: 4, height: 3, frameWidth: 4, frameHeight: 3 });
});

test("a frame whose previous won't decode is encoded whole, leaving the error to the previous frame's job", async () => {
  const now = bitmap('now', 4, 3, [1, 1, 1, 255]);

  await worker.onmessage({ data: { index: 1, image: frame(now), previous: new Blob(['broken']), alpha: false } });

  const [[{ index, result }]] = worker.postMessage.mock.calls;
  expect(index).toBe(1);
  expect(console.warn).toHaveBeenCalledWith('APNG frame', 2, 'is stored whole: the frame before it would not decode', expect.any(TypeError));
  expect(result).toMatchObject({ x: 0, y: 0, width: 4, height: 3 });
});

/** A PNG of RGBA `pixels`, as png.js reads it. */
const pngOf = async (pixels, width, height) => {
  const encoded = await encodeApngFrame({ pixels, previous: null, width, height, alpha: true });

  return new Blob([muxApng({ width, height, alpha: true, frames: [{ ...encoded, delay: 100 }] })]);
};

test('with exact, a PNG frame is decoded exactly, semi-transparent pixels and all, without the canvas', async () => {
  const pixels = new Uint8Array([200, 100, 50, 3, 10, 20, 30, 255, 0, 0, 0, 0, 255, 1, 2, 128]);

  await worker.onmessage({ data: { index: 0, image: await pngOf(pixels, 2, 2), previous: null, alpha: true, exact: true } });

  expect(createImageBitmap).not.toHaveBeenCalled();
  const [[{ result }]] = worker.postMessage.mock.calls;
  const apng = probeApng(muxApng({ width: 2, height: 2, alpha: true, frames: [{ ...result, delay: 100 }] }));
  expect(Array.from(apng.frames[0].rgba)).toEqual(Array.from(pixels));
});

test('with exact, the PNG frame before is decoded by png.js too, so only what changed is stored', async () => {
  const before = new Uint8Array([200, 100, 50, 3, 10, 20, 30, 255, 0, 0, 0, 0, 255, 1, 2, 128]);
  const now = before.slice();
  now.set([9, 9, 9, 255], 8);

  await worker.onmessage({ data: { index: 1, image: await pngOf(now, 2, 2), previous: await pngOf(before, 2, 2), alpha: true, exact: true } });

  expect(createImageBitmap).not.toHaveBeenCalled();
  const [[{ result }]] = worker.postMessage.mock.calls;
  expect(result).toMatchObject({ x: 0, y: 1, width: 1, height: 1 });
});

test('without exact, a PNG frame goes through the browser, colours converted', async () => {
  const image = await pngOf(new Uint8Array([1, 2, 3, 255]), 1, 1);
  bitmaps.set(image, bitmap('png', 1, 1, [1, 2, 3, 255]));

  await worker.onmessage({ data: { index: 0, image, previous: null, alpha: true, exact: false } });

  expect(createImageBitmap).toHaveBeenCalledWith(image, { colorSpaceConversion: 'default' });
});

test('with exact, a JPEG frame still goes through the browser, colours converted', async () => {
  const image = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]);
  bitmaps.set(image, bitmap('jpeg', 1, 1, [1, 2, 3, 255]));

  await worker.onmessage({ data: { index: 0, image, previous: null, alpha: false, exact: true } });

  expect(createImageBitmap).toHaveBeenCalledWith(image, { colorSpaceConversion: 'default' });
});

/** A 2x2 palette PNG using colour 5 of a one-colour palette: its header reads fine, but png.js refuses its pixels. */
const paletteOverrun = name => new Blob([new Uint8Array(Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk('IHDR', [0, 0, 0, 2, 0, 0, 0, 2, 8, 3, 0, 0, 0]),
  pngChunk('PLTE', [1, 2, 3]),
  pngChunk('IDAT', zlib.deflateSync(Buffer.from([0, 5, 5, 0, 5, 5]))),
  pngChunk('IEND', [])
]))], { type: name });

test("a PNG png.js won't take goes through the browser with its colours as stored, warning once with its frame number", async () => {
  const image = paletteOverrun('now');
  const previous = paletteOverrun('before');
  bitmaps.set(image, bitmap('now', 2, 2, [7, 6, 5, 4]));
  bitmaps.set(previous, bitmap('before', 2, 2, [0, 0, 0, 255]));

  await worker.onmessage({ data: { index: 3, image, previous, alpha: true, exact: true } });

  expect(createImageBitmap.mock.calls).toEqual([[image, { colorSpaceConversion: 'none' }], [previous, { colorSpaceConversion: 'none' }]]);
  // The previous frame's own job warns about it.
  expect(console.warn).toHaveBeenCalledExactlyOnceWith('png.js could not decode APNG frame', 4, 'so the browser decodes it',
    new Error('The PNG uses colour 5 of a palette of 1'));
  const [[{ result }]] = worker.postMessage.mock.calls;
  expect(result).toMatchObject({ x: 0, y: 0, width: 2, height: 2 });
  const apng = probeApng(muxApng({ width: 2, height: 2, alpha: true, frames: [{ ...result, delay: 1 }] }));
  expect(Array.from(apng.frames[0].rgba)).toEqual(Array.from(bitmap('now', 2, 2, [7, 6, 5, 4]).pixels));
});

test('a PNG fflate inflates for png.js is logged once, with its frame number and the browser\'s reason', async () => {
  const junkAfter = pixel => new Blob([new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    pngChunk('IDAT', Buffer.concat([zlib.deflateSync(Buffer.from([0, ...pixel])), Buffer.from([1, 2, 3, 4])])),
    pngChunk('IEND', [])
  ]))]);
  vi.stubGlobal('DecompressionStream', class {
    constructor() {
      return new TransformStream({ transform() { throw new TypeError('Junk found after end of compressed data.'); } });
    }
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});

  await worker.onmessage({ data: { index: 3, image: junkAfter([9, 9, 9, 128]), previous: junkAfter([1, 2, 3, 4]), alpha: true, exact: true } });

  expect(createImageBitmap).not.toHaveBeenCalled();
  // The previous frame's own job logs it.
  expect(console.info).toHaveBeenCalledExactlyOnceWith('APNG frame', 4, 'was inflated with fflate, as the browser refused its image data:',
    'Junk found after end of compressed data.');
  const [[{ result }]] = worker.postMessage.mock.calls;
  expect(zlib.inflateSync(result.data).subarray(1)).toEqual(Buffer.from([9, 9, 9, 128]));
});

test("when the browser can't decode a PNG png.js refused either, the error gives both reasons", async () => {
  createImageBitmap.mockRejectedValueOnce(new DOMException('The source image could not be decoded.', 'InvalidStateError'));

  await worker.onmessage({ data: { index: 0, image: paletteOverrun('broken'), previous: null, alpha: true, exact: true } });

  expect(worker.postMessage).toHaveBeenCalledWith({
    index: 0,
    error: 'Error: The PNG uses colour 5 of a palette of 1; the browser could not decode it either ' +
      '(InvalidStateError: The source image could not be decoded.)'
  });
});

test('a frame that fails answers with the error, naming its kind, and logs it', async () => {
  const error = new DOMException('The source image cannot be decoded.', 'EncodingError');
  createImageBitmap.mockRejectedValueOnce(error);

  await worker.onmessage({ data: { index: 2, image: new Blob(['not an image']), previous: null, alpha: false } });

  expect(worker.postMessage).toHaveBeenCalledWith({ index: 2, error: 'EncodingError: The source image cannot be decoded.' });
  expect(console.error).toHaveBeenCalledWith('Could not encode APNG frame', 3, error);
});

test('a message that is not a frame answers with an error rather than nothing', async () => {
  await worker.onmessage({ data: null });

  expect(worker.postMessage).toHaveBeenCalledWith({ index: undefined, error: expect.stringContaining('TypeError') });
});

test('an error it cannot answer with goes to reportError, which reaches the page', async () => {
  // String() of an object with no prototype throws.
  createImageBitmap.mockRejectedValueOnce(Object.create(null));

  await worker.onmessage({ data: { index: 1, image: new Blob(['jpeg']), previous: null, alpha: false } });

  expect(worker.postMessage).not.toHaveBeenCalled();
  expect(reportError).toHaveBeenCalledWith(expect.any(TypeError));
});

test('a frame it cannot read goes to reportError', () => {
  worker.onmessageerror(new Event('messageerror'));

  expect(reportError).toHaveBeenCalledWith(new Error('The APNG worker could not read a frame'));
});
