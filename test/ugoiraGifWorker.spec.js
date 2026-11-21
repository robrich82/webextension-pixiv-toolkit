/**
 * gif.worker.js over stubbed worker globals: Node has no createImageBitmap, OffscreenCanvas or
 * reportError. The e2e tests run it in the browsers.
 */
import { joinGif } from '@/options_page/modules/UgoiraEncoders/gifFrame';
import { probeGif } from './helpers/probeGif.mjs';

/** A 2x1 canvas that logs the drawing calls and reads back `pixels`. */
class FakeCanvas {
  static log = [];
  static pixels;

  constructor(width, height) {
    FakeCanvas.log.push(['canvas', width, height]);
  }

  getContext() {
    const log = FakeCanvas.log;

    return {
      fillStyle: null,
      fillRect(...args) {
        log.push(['fillRect', this.fillStyle, ...args]);
      },
      drawImage(image, ...args) {
        log.push(['drawImage', image.name, ...args]);
      },
      getImageData: () => ({ data: FakeCanvas.pixels })
    };
  }
}

let worker;
let bitmap;

beforeEach(async () => {
  FakeCanvas.log = [];
  FakeCanvas.pixels = new Uint8ClampedArray([200, 100, 50, 255, 200, 100, 50, 255]);
  bitmap = { name: 'bitmap', width: 2, height: 1, close: vi.fn() };
  worker = { postMessage: vi.fn() };
  vi.stubGlobal('self', worker);
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
  vi.stubGlobal('reportError', vi.fn());
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.resetModules();
  await import('@/options_page/modules/UgoiraEncoders/gif.worker.js');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('draws the frame over black, then answers with its chunk, handing over the buffer', async () => {
  const image = new Blob(['jpeg']);

  await worker.onmessage({ data: { index: 0, image, delay: 40, first: true } });

  expect(createImageBitmap).toHaveBeenCalledWith(image);
  expect(FakeCanvas.log).toEqual([
    ['canvas', 2, 1],
    ['fillRect', '#000', 0, 0, 2, 1],
    ['drawImage', 'bitmap', 0, 0]
  ]);
  expect(bitmap.close).toHaveBeenCalled();

  const [[message, transfer]] = worker.postMessage.mock.calls;
  expect(message.index).toBe(0);
  expect(transfer).toEqual([message.result.buffer]);

  const gif = probeGif(joinGif([message.result]));
  expect(gif).toMatchObject({ width: 2, height: 1, loops: 0 });
  expect(gif.frames.map(({ delay, rgb }) => [delay, [...rgb.subarray(0, 3)]])).toEqual([[40, [200, 100, 50]]]);
});

test('a later frame writes no header', async () => {
  await worker.onmessage({ data: { index: 3, image: new Blob(['jpeg']), delay: 40, first: false } });

  const [[{ index, result: chunk }]] = worker.postMessage.mock.calls;
  expect(index).toBe(3);
  // The frame's graphic control extension, not the "G" of "GIF89a".
  expect(chunk[0]).toBe(0x21);
});

test('a frame that fails answers with the error, naming its kind, and logs it', async () => {
  const error = new DOMException('The source image cannot be decoded.', 'EncodingError');
  createImageBitmap.mockRejectedValueOnce(error);

  await worker.onmessage({ data: { index: 2, image: new Blob(['not an image']), delay: 40, first: false } });

  expect(worker.postMessage).toHaveBeenCalledWith({ index: 2, error: 'EncodingError: The source image cannot be decoded.' });
  expect(console.error).toHaveBeenCalledWith('Could not encode GIF frame', 2, error);
});

test('a message that is not a frame answers with an error rather than nothing', async () => {
  await worker.onmessage({ data: null });

  expect(worker.postMessage).toHaveBeenCalledWith({ index: undefined, error: expect.stringContaining('TypeError') });
});

test('an error it cannot answer with goes to reportError, which reaches the page', async () => {
  // String() of an object with no prototype throws.
  createImageBitmap.mockRejectedValueOnce(Object.create(null));

  await worker.onmessage({ data: { index: 1, image: new Blob(['jpeg']), delay: 40, first: false } });

  expect(worker.postMessage).not.toHaveBeenCalled();
  expect(reportError).toHaveBeenCalledWith(expect.any(TypeError));
});

test('a frame it cannot read goes to reportError', () => {
  worker.onmessageerror(new Event('messageerror'));

  expect(reportError).toHaveBeenCalledWith(new Error('The GIF worker could not read a frame'));
});
