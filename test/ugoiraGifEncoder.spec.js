/**
 * The GIF encoder: gifFrame.js's frames through the real gifenc, read back with probeGif, and
 * gif.js's worker pool over fake workers that run the same encodeGifFrame. Node has no Worker,
 * createImageBitmap or OffscreenCanvas: ugoiraGifWorker.spec.js stubs them for gif.worker.js, and
 * the e2e tests run it for real.
 */
import { FALLBACK_DELAY } from '@/options_page/modules/UgoiraEncoders/delay';
import { encodeGifFrame, gifDelay, gifDelays, joinGif } from '@/options_page/modules/UgoiraEncoders/gifFrame';
import { encodeGif } from '@/options_page/modules/UgoiraEncoders/gif';
import { workerCount } from '@/options_page/modules/UgoiraEncoders/pool';
import { probeGif } from './helpers/probeGif.mjs';

/** A frame of one colour. */
const solid = (width, height, [r, g, b]) => {
  const rgba = new Uint8Array(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    rgba.set([r, g, b, 255], i * 4);
  }

  return rgba;
};

/** A 64x32 frame of 2048 colours, more than one palette holds. */
const gradient = () => {
  const width = 64;
  const height = 32;
  const rgba = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rgba.set([x * 4, y * 8, (x + y) * 2, 255], (y * width + x) * 4);
    }
  }

  return { rgba, width, height };
};

const psnr = (rgba, rgb) => {
  let sum = 0;

  for (let i = 0; i < rgb.length / 3; i++) {
    for (let c = 0; c < 3; c++) {
      sum += (rgba[i * 4 + c] - rgb[i * 3 + c]) ** 2;
    }
  }

  return 10 * Math.log10(255 ** 2 / (sum / rgb.length));
};

const pixels = (frame, count = frame.width * frame.height) =>
  Array.from({ length: count }, (_, i) => [...frame.rgb.subarray(i * 3, i * 3 + 3)]);

describe('gifDelay', () => {
  test.each([
    ['a whole number of ms', 100, 100],
    ['a delay under 20ms at 20ms, since browsers play 10ms or less for 100ms', 10, 20],
    ['19ms at 20ms', 19, 20],
    ['20ms as it is', 20, 20],
    ['a delay past what a GIF holds at 655.35s', 1e9, 655350],
    ['no delay at the fallback', undefined, FALLBACK_DELAY],
    ['0 at the fallback', 0, FALLBACK_DELAY],
    ['a negative delay at the fallback', -40, FALLBACK_DELAY],
    ['NaN at the fallback', NaN, FALLBACK_DELAY]
  ])('gives %s', (_, delay, expected) => {
    expect(gifDelay(delay)).toBe(expected);
  });
});

describe('gifDelays', () => {
  test.each([
    ['30fps delays, rounding each start rather than each delay', [33, 34, 33, 33, 34, 33], [30, 40, 30, 30, 40, 30]],
    ['25ms delays', [25, 25, 25, 25], [30, 20, 30, 20]],
    ['whole 10ms as they are', [40, 100, 70], [40, 100, 70]],
    ['delays of 10 and 19ms at 20ms, and 0 at the fallback', [10, 0, 19], [20, FALLBACK_DELAY, 20]],
    ['no frames as none', [], []]
  ])('gives %s', (_, delays, expected) => {
    expect(gifDelays(delays)).toEqual(expected);
  });

  test('keeps a frame at the cap there, though fractional delays before it round its start', () => {
    expect(gifDelays([...Array(50).fill(33.3), 655350]).at(-1)).toBe(655350);
  });
});

describe('encodeGifFrame and joinGif', () => {
  test('make a looping GIF of the frames, each with its own delay and palette', () => {
    const gif = probeGif(joinGif([
      encodeGifFrame(solid(4, 3, [255, 0, 0]), 4, 3, { delay: 100, first: true }),
      encodeGifFrame(solid(4, 3, [0, 0, 255]), 4, 3, { delay: 250, first: false }),
      encodeGifFrame(solid(4, 3, [0, 255, 0]), 4, 3, { delay: 10, first: false })
    ]));

    expect(gif).toMatchObject({ width: 4, height: 3, loops: 0 });
    expect(gif.frames.map(frame => frame.delay)).toEqual([100, 250, 20]);
    // The first frame's palette is the GIF's; each later one carries its own.
    expect(gif.frames.map(frame => frame.localPalette)).toEqual([false, true, true]);
    expect(gif.frames.map(frame => pixels(frame, 1)[0])).toEqual([[255, 0, 0], [0, 0, 255], [0, 255, 0]]);
    expect(gif.frames.map(frame => frame.distinctColors)).toEqual([1, 1, 1]);
  });

  test('round a delay to the 10ms a GIF stores, and cap it at 655.35s', () => {
    const gif = probeGif(joinGif([
      encodeGifFrame(solid(2, 2, [9, 9, 9]), 2, 2, { delay: 1005, first: true }),
      encodeGifFrame(solid(2, 2, [9, 9, 9]), 2, 2, { delay: 1e9, first: false }),
      encodeGifFrame(solid(2, 2, [9, 9, 9]), 2, 2, { delay: undefined, first: false })
    ]));

    expect(gif.frames.map(frame => frame.delay)).toEqual([1010, 655350, FALLBACK_DELAY]);
  });

  test('keep a frame of more than 256 colours close to the original in 256', () => {
    const { rgba, width, height } = gradient();
    const [frame] = probeGif(joinGif([encodeGifFrame(rgba, width, height, { delay: 100, first: true })])).frames;

    expect(frame).toMatchObject({ width, height, colors: 256 });
    expect(psnr(rgba, frame.rgb)).toBeGreaterThan(35);
  });

  test('ignore alpha, which the worker has drawn over black', () => {
    const rgba = solid(2, 1, [200, 100, 50]);
    rgba[3] = 0;
    const [frame] = probeGif(joinGif([encodeGifFrame(rgba, 2, 1, { delay: 100, first: true })])).frames;

    expect(pixels(frame)).toEqual([[200, 100, 50], [200, 100, 50]]);
  });
});

describe('workerCount', () => {
  test.each([
    [10, 8, 4],
    [10, 3, 2],
    [10, 2, 1],
    [10, 1, 1],
    [10, 0, 1],
    [2, 8, 2],
    [1, 8, 1]
  ])('%i frames on %i cores (0 when unknown): %i workers', (frames, cores, expected) => {
    expect(workerCount(frames, cores)).toBe(expected);
  });
});

describe('encodeGif', () => {
  /** Runs gif.worker.js's encodeGifFrame on { rgba, width, height } images, answering after `wait` ms. */
  class FakeWorker {
    static created = [];
    /** Set to answer every frame with this error instead. */
    static failWith;
    posted = [];
    terminated = false;
    onmessage = null;
    onerror = null;

    constructor() {
      FakeWorker.created.push(this);
    }

    postMessage(message) {
      this.posted.push(message);
      const { index, image, delay, first } = message;

      setTimeout(() => {
        if (this.terminated) {
          return;
        }

        this.onmessage({
          data: FakeWorker.failWith && index === 1 ?
            { index, error: FakeWorker.failWith } :
            { index, result: encodeGifFrame(image.rgba, image.width, image.height, { delay, first }) }
        });
      }, image.wait ?? 0);
    }

    terminate() {
      this.terminated = true;
    }
  }

  const COLORS = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255]];
  /** One 3x2 frame per colour, the first ones slowest, so workers finish out of order. */
  const frames = (colors = COLORS) => colors.map((color, i) => ({
    image: { rgba: solid(3, 2, color), width: 3, height: 2, wait: (colors.length - i) * 5 },
    delay: 40 * (i + 1)
  }));
  const createWorker = () => new FakeWorker();
  /** Workers that answer every frame with `answer(worker, message)` instead of encoding it. */
  const workersThat = answer => () => {
    const worker = new FakeWorker();
    worker.postMessage = message => setTimeout(() => answer(worker, message));
    return worker;
  };

  beforeEach(() => {
    FakeWorker.created = [];
    FakeWorker.failWith = undefined;
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('joins the frames in order, though the workers finish out of order, and ends the workers', async () => {
    const result = await encodeGif({ frames: frames(), createWorker });

    expect(result).toMatchObject({ mimeType: 'image/gif', extension: 'gif' });
    const gif = probeGif(result.data);
    expect(gif).toMatchObject({ width: 3, height: 2, loops: 0 });
    expect(gif.frames.map(frame => pixels(frame, 1)[0])).toEqual(COLORS);
    expect(gif.frames.map(frame => frame.delay)).toEqual([40, 80, 120, 160, 200]);

    // 4 cores leave 3 workers, which share the five frames; only frame 0 writes the header.
    expect(FakeWorker.created).toHaveLength(3);
    expect(FakeWorker.created.flatMap(worker => worker.posted).map(({ index, first }) => [index, first]).sort())
      .toEqual([[0, true], [1, false], [2, false], [3, false], [4, false]]);
    expect(FakeWorker.created.every(worker => worker.terminated)).toBe(true);
  });

  test('hands each worker its next frame only once it has answered', async () => {
    await encodeGif({ frames: frames(), createWorker });

    // Frames take 25, 20, 15, 10 and 5ms: frame 2's worker is free first and takes frame 3, then
    // frame 1's worker takes frame 4.
    expect(FakeWorker.created.map(worker => worker.posted.map(message => message.index))).toEqual([[0], [1, 4], [2, 3]]);
  });

  test("rounds each frame's start to 10ms, so 30fps frames don't play fast", async () => {
    const near = frames([...COLORS, [9, 9, 9]]).map((frame, i) => ({ ...frame, delay: [33, 34, 33, 33, 34, 33][i] }));
    const gif = probeGif((await encodeGif({ frames: near, createWorker })).data);

    expect(gif.frames.map(frame => frame.delay)).toEqual([30, 40, 30, 30, 40, 30]);
  });

  test('reports the share of frames encoded', async () => {
    const progresses = [];

    await encodeGif({ frames: frames(COLORS.slice(0, 3)), createWorker, onProgress: progress => progresses.push(progress) });

    expect(progresses).toEqual([1 / 3, 2 / 3, 1]);
  });

  test('a single frame uses a single worker', async () => {
    const gif = probeGif((await encodeGif({ frames: frames([[1, 2, 3]]), createWorker })).data);

    expect(FakeWorker.created).toHaveLength(1);
    expect(gif.frames).toHaveLength(1);
  });

  test('an abort ends every worker and rejects with its reason', async () => {
    const controller = new AbortController();
    const progresses = [];
    const encoding = encodeGif({
      frames: frames(),
      createWorker,
      signal: controller.signal,
      onProgress: progress => {
        progresses.push(progress);
        controller.abort(new Error('stopped'));
      }
    });

    await expect(encoding).rejects.toThrow('stopped');
    expect(progresses).toEqual([0.2]);
    expect(FakeWorker.created.every(worker => worker.terminated)).toBe(true);
    // The worker that answered was handed nothing more.
    expect(FakeWorker.created.flatMap(worker => worker.posted)).toHaveLength(3);
  });

  test('a signal already aborted rejects without starting a worker', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stopped'));

    await expect(encodeGif({ frames: frames(), createWorker, signal: controller.signal })).rejects.toThrow('stopped');
    expect(FakeWorker.created).toEqual([]);
  });

  test('a frame that fails to encode rejects naming it, and ends every worker', async () => {
    FakeWorker.failWith = 'The source image cannot be decoded.';

    await expect(encodeGif({ frames: frames(), createWorker }))
      .rejects.toThrow('Could not encode GIF frame 2: The source image cannot be decoded.');
    expect(FakeWorker.created.every(worker => worker.terminated)).toBe(true);
  });

  test('a worker that fails to load rejects, and ends every worker', async () => {
    const encoding = encodeGif({
      frames: frames(),
      createWorker: workersThat(worker => worker.onerror({ message: '', preventDefault() {} }))
    });

    await expect(encoding).rejects.toThrow('The GIF encoder failed: its worker did not load');
    expect(FakeWorker.created.every(worker => worker.terminated)).toBe(true);
  });

  test('a later message from an ended encoding is ignored', async () => {
    FakeWorker.failWith = 'The source image cannot be decoded.';
    const progresses = [];

    await expect(encodeGif({ frames: frames(), createWorker, onProgress: progress => progresses.push(progress) }))
      .rejects.toThrow('Could not encode GIF frame 2');
    const reported = progresses.length;
    const [worker] = FakeWorker.created;

    worker.onmessage({ data: { index: 0, result: encodeGifFrame(solid(3, 2, [5, 5, 5]), 3, 2, { delay: 40, first: true }) } });
    expect(progresses).toHaveLength(reported);
  });

  test('a worker that cannot be created rejects, and ends the ones already started', async () => {
    let made = 0;
    const encoding = encodeGif({
      frames: frames(),
      createWorker: () => {
        if (++made === 2) {
          throw new Error('Worker blocked');
        }

        return new FakeWorker();
      }
    });

    await expect(encoding).rejects.toThrow('Worker blocked');
    expect(FakeWorker.created).toHaveLength(1);
    expect(FakeWorker.created[0].terminated).toBe(true);
  });

  test('a throwing progress listener rejects instead of hanging, and ends every worker', async () => {
    const encoding = encodeGif({
      frames: frames(),
      createWorker,
      onProgress: () => {
        throw new Error('listener broke');
      }
    });

    await expect(encoding).rejects.toThrow('listener broke');
    expect(FakeWorker.created.every(worker => worker.terminated)).toBe(true);
  });

  test('a GIF that cannot be joined rejects instead of hanging', async () => {
    const encoding = encodeGif({
      frames: frames([[1, 2, 3]]),
      createWorker: workersThat((worker, { index }) => worker.onmessage({ data: { index, result: null } }))
    });

    await expect(encoding).rejects.toThrow(TypeError);
    expect(FakeWorker.created[0].terminated).toBe(true);
  });

  test('a message the page cannot read rejects, and ends every worker', async () => {
    const encoding = encodeGif({
      frames: frames(),
      createWorker: workersThat(worker => worker.onmessageerror(new Event('messageerror')))
    });

    await expect(encoding).rejects.toThrow('The GIF encoder sent a message that could not be read');
    expect(FakeWorker.created.every(worker => worker.terminated)).toBe(true);
  });

  test.each([
    ['its message', 'ReferenceError: x is not defined', 'ReferenceError: x is not defined (gif.worker-abc.js:7)'],
    ['no message as unknown, not as a worker that did not load', '', 'an unknown error (gif.worker-abc.js:7)']
  ])("a worker's uncaught error rejects with %s and where it was thrown", async (_, message, expected) => {
    const encoding = encodeGif({
      frames: frames(),
      createWorker: workersThat(worker => worker.onerror({ message, filename: 'gif.worker-abc.js', lineno: 7, preventDefault() {} }))
    });

    await expect(encoding).rejects.toThrow(`The GIF encoder failed: ${expected}`);
  });

  test('no frames rejects', async () => {
    await expect(encodeGif({ frames: [], createWorker })).rejects.toThrow('The ugoira has no frames to encode');
    expect(FakeWorker.created).toEqual([]);
  });
});
