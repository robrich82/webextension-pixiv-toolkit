/**
 * apng.worker.js over stubbed worker globals: Node has no createImageBitmap, OffscreenCanvas or
 * reportError. The e2e tests run it in the browsers.
 */
import { muxApng } from '@/options_page/modules/UgoiraEncoders/apngFrame';
import { probeApng } from './helpers/probeApng.mjs';

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

  expect(createImageBitmap).toHaveBeenCalledWith(image);
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
});

test('a frame whose previous is another size is encoded whole, for the page to refuse', async () => {
  const now = bitmap('now', 4, 3, [1, 1, 1, 255]);

  await worker.onmessage({ data: { index: 1, image: frame(now), previous: frame(bitmap('before', 5, 3, [1, 1, 1, 255])), alpha: false } });

  const [[{ result }]] = worker.postMessage.mock.calls;
  expect(result).toMatchObject({ x: 0, y: 0, width: 4, height: 3, frameWidth: 4, frameHeight: 3 });
});

test('a frame that fails answers with the error, naming its kind, and logs it', async () => {
  const error = new DOMException('The source image cannot be decoded.', 'EncodingError');
  createImageBitmap.mockRejectedValueOnce(error);

  await worker.onmessage({ data: { index: 2, image: new Blob(['not an image']), previous: null, alpha: false } });

  expect(worker.postMessage).toHaveBeenCalledWith({ index: 2, error: 'EncodingError: The source image cannot be decoded.' });
  expect(console.error).toHaveBeenCalledWith('Could not encode APNG frame', 2, error);
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
