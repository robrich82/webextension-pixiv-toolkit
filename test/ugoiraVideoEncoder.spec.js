/**
 * The WebCodecs ugoira encoder's choices, against the real Mediabunny output formats. Node has no
 * VideoEncoder, so which codecs "encode" is faked through canEncodeVideo, and encodeVideo runs
 * against a fake Output and CanvasSource; e2e/ugoira.e2e.js and e2e-firefox/downloads.test.mjs run
 * the real encode.
 */
import { MkvOutputFormat, MovOutputFormat, Mp4OutputFormat, canEncodeVideo } from 'mediabunny';
import {
  FALLBACK_DELAY, VIDEO_CONTAINERS, chooseCodec, codecSettingKey, containerCodecs, encodeVideo, encodedSize, frameTimes
} from '@/options_page/modules/UgoiraEncoders/video';
import defaultSettings from '@/config/default';

const fakes = vi.hoisted(() => {
  const outputs = [];
  const sources = [];
  /** Called with each fake as it is made, to set up how it behaves. */
  const hooks = {};

  /** Mediabunny's Output, as far as encodeVideo drives it. */
  class FakeOutput {
    state = 'pending';
    sources = [];

    constructor({ format, target }) {
      this.format = format;
      this.target = target;
      outputs.push(this);
      hooks.output?.(this);
    }

    addVideoTrack(source) {
      this.sources.push(source);
    }

    start = vi.fn(async () => {
      this.state = 'started';
    });

    finalize = vi.fn(async () => {
      this.target.buffer = new Uint8Array([1, 2, 3]).buffer;
      this.state = 'finalized';
    });

    /** A pending add() returns early, as Mediabunny's does once its encoder is closed. */
    cancel = vi.fn(async () => {
      this.state = 'canceled';
      this.sources.forEach(source => source.pending?.resolve());
    });
  }

  class FakeCanvasSource {
    /** add()'s settlers while one is held pending. */
    pending = null;

    constructor(canvas, config) {
      this.canvas = canvas;
      this.config = config;
      sources.push(this);
      hooks.source?.(this);
    }

    add = vi.fn(async () => {});
  }

  return { outputs, sources, hooks, FakeOutput, FakeCanvasSource };
});

vi.mock('mediabunny', async importOriginal => ({
  ...await importOriginal(),
  canEncodeVideo: vi.fn(),
  BufferTarget: class {
    buffer = null;
  },
  Output: fakes.FakeOutput,
  CanvasSource: fakes.FakeCanvasSource
}));

/** Lets the browser encode only these codecs. */
const encodable = (...codecs) => canEncodeVideo.mockImplementation(async codec => codecs.includes(codec));

beforeEach(() => {
  canEncodeVideo.mockReset();
  fakes.outputs.length = 0;
  fakes.sources.length = 0;
  fakes.hooks.output = fakes.hooks.source = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('containerCodecs', () => {
  it('offers the codecs WebM holds, H.264 and H.265 not among them', () => {
    expect(containerCodecs('webm')).toEqual(['vp9', 'av1', 'vp8']);
  });

  it.each(['mp4', 'mov', 'mkv'])('offers every codec for %s, H.264 first', container => {
    expect(containerCodecs(container)).toEqual(['avc', 'vp9', 'av1', 'hevc', 'vp8']);
  });
});

describe('chooseCodec', () => {
  it('uses the preferred codec when the browser can encode it', async () => {
    vi.spyOn(console, 'info');
    encodable('vp9', 'vp8');

    expect(await chooseCodec('webm', 'vp9', { width: 16, height: 16 })).toBe('vp9');
    expect(console.info).not.toHaveBeenCalled();
  });

  it('falls back to the first codec it can encode, in the offered order', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    encodable('vp8');

    expect(await chooseCodec('webm', 'vp9', { width: 16, height: 16 })).toBe('vp8');
    expect(canEncodeVideo.mock.calls.map(([codec]) => codec)).toEqual(['vp9', 'av1', 'vp8']);
    expect(console.info).toHaveBeenCalledWith("Encoding webm as vp8: this browser can't encode vp9 at 16x16");
  });

  it('ignores a preferred codec the container cannot hold', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    encodable('avc', 'av1');

    expect(await chooseCodec('webm', 'avc', { width: 16, height: 16 })).toBe('av1');
    expect(canEncodeVideo).not.toHaveBeenCalledWith('avc', expect.anything());
  });

  it('asks at the size each codec would encode', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    encodable('vp9');

    await chooseCodec('mp4', 'avc', { width: 15, height: 9 });

    expect(canEncodeVideo).toHaveBeenNthCalledWith(1, 'avc', expect.objectContaining({ width: 16, height: 10 }));
    expect(canEncodeVideo).toHaveBeenNthCalledWith(2, 'vp9', expect.objectContaining({ width: 15, height: 9 }));
  });

  it('fails when the browser can encode none of them', async () => {
    encodable();

    await expect(chooseCodec('webm', 'vp9', { width: 1920, height: 1080 }))
      .rejects.toThrow("This browser can't encode WEBM video at 1920x1080 (tried vp9, av1, vp8)");
  });
});

describe('encodedSize', () => {
  it('rounds H.264 and H.265 up to even dimensions', () => {
    expect(encodedSize('avc', { width: 15, height: 9 })).toEqual({ width: 16, height: 10 });
    expect(encodedSize('hevc', { width: 16, height: 9 })).toEqual({ width: 16, height: 10 });
  });

  it('leaves other codecs at the frame size', () => {
    expect(encodedSize('vp9', { width: 15, height: 9 })).toEqual({ width: 15, height: 9 });
  });
});

describe('frameTimes', () => {
  it('starts each frame where the delays before it end, and lasts its own delay (#322, #325)', () => {
    expect(frameTimes([{ delay: 30 }, { delay: 70 }, { delay: 1000 }])).toEqual([
      { timestamp: 0, duration: 0.03 },
      { timestamp: 0.03, duration: 0.07 },
      { timestamp: 0.1, duration: 1 }
    ]);
  });

  it('keeps delays that share no 10ms step, which FFmpeg rounded', () => {
    expect(frameTimes([{ delay: 33 }, { delay: 34 }]).map(time => time.duration)).toEqual([0.033, 0.034]);
  });

  it('gives a frame without a usable delay the fallback', () => {
    expect(frameTimes([{ delay: 0 }, { delay: -5 }, {}, { delay: 50 }])).toEqual([
      { timestamp: 0, duration: FALLBACK_DELAY / 1000 },
      { timestamp: FALLBACK_DELAY / 1000, duration: FALLBACK_DELAY / 1000 },
      { timestamp: 2 * FALLBACK_DELAY / 1000, duration: FALLBACK_DELAY / 1000 },
      { timestamp: 3 * FALLBACK_DELAY / 1000, duration: 0.05 }
    ]);
  });
});

describe('encodeVideo', () => {
  /** @type {{ image: Blob, width: number, height: number, close: Function }[]} */
  let bitmaps;
  let draws;

  const FRAMES = [100, 100, 150].map((delay, i) => ({ delay, image: new Blob([`frame ${i}`], { type: 'image/jpeg' }) }));

  const output = () => fakes.outputs[0];
  const source = () => fakes.sources[0];
  const allClosed = () => bitmaps.every(bitmap => bitmap.close.mock.calls.length === 1);

  beforeEach(() => {
    bitmaps = [];
    draws = [];
    vi.stubGlobal('createImageBitmap', vi.fn(async image => {
      const bitmap = { image, width: 17, height: 17, close: vi.fn() };
      bitmaps.push(bitmap);
      return bitmap;
    }));
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(width, height) {
        Object.assign(this, { width, height });
      }

      getContext() {
        return { fillRect: () => {}, drawImage: bitmap => draws.push(bitmap.image) };
      }
    });
    encodable('vp9', 'vp8');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds each frame at its own time and returns the finished file', async () => {
    const onProgress = vi.fn();
    const controller = new AbortController();

    const result = await encodeVideo({ frames: FRAMES, container: 'webm', onProgress, signal: controller.signal });
    // A stop once it is done cancels nothing.
    controller.abort();
    expect(output().cancel).not.toHaveBeenCalled();

    expect(result).toEqual({
      data: new Uint8Array([1, 2, 3]).buffer, mimeType: 'video/webm', extension: 'webm', codec: 'vp9'
    });
    expect(draws).toEqual(FRAMES.map(frame => frame.image));
    expect(source().add.mock.calls).toEqual([[0, 0.1], [0.1, 0.1], [0.2, 0.15]]);
    expect(onProgress.mock.calls).toEqual([[1 / 3], [2 / 3], [1]]);
    expect(source().canvas).toMatchObject({ width: 17, height: 17 });
    expect(bitmaps).toHaveLength(3);
    expect(allClosed()).toBe(true);
  });

  it('encodes with the codec chosen when the preferred one fails', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    encodable('vp8');

    const { codec } = await encodeVideo({ frames: FRAMES, container: 'webm' });

    expect(codec).toBe('vp8');
    expect(source().config.codec).toBe('vp8');
  });

  it('encodes with the codec asked for, over the container default', async () => {
    const { codec } = await encodeVideo({ frames: FRAMES, container: 'webm', codec: 'vp8' });

    expect(codec).toBe('vp8');
    expect(source().config.codec).toBe('vp8');
    expect(canEncodeVideo).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['mp4', Mp4OutputFormat, 'video/mp4'],
    ['mov', MovOutputFormat, 'video/quicktime'],
    ['mkv', MkvOutputFormat, 'video/x-matroska']
  ])('encodes %s as H.264, padded to even dimensions', async (container, Format, mimeType) => {
    encodable('avc', 'vp9');

    const result = await encodeVideo({ frames: FRAMES, container });

    expect(result).toMatchObject({ mimeType, extension: container, codec: 'avc' });
    expect(source().canvas).toMatchObject({ width: 18, height: 18 });
    expect(output().format).toBeInstanceOf(Format);
  });

  it('keeps an MP4 without H.264 at the frame size, in MP4', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    encodable('vp9');

    const result = await encodeVideo({ frames: FRAMES, container: 'mp4' });

    expect(result).toMatchObject({ mimeType: 'video/mp4', extension: 'mp4', codec: 'vp9' });
    expect(source().canvas).toMatchObject({ width: 17, height: 17 });
  });

  it('closes the first frame when no codec encodes', async () => {
    encodable();

    await expect(encodeVideo({ frames: FRAMES, container: 'webm' })).rejects.toThrow("can't encode WEBM");

    expect(fakes.outputs).toEqual([]);
    expect(bitmaps).toHaveLength(1);
    expect(allClosed()).toBe(true);
  });

  it('starts nothing when the signal is already aborted', async () => {
    const reason = new Error('stopped');

    await expect(encodeVideo({ frames: FRAMES, container: 'webm', signal: AbortSignal.abort(reason) }))
      .rejects.toBe(reason);

    expect(output().start).not.toHaveBeenCalled();
    expect(output().state).toBe('canceled');
    expect(allClosed()).toBe(true);
  });

  it('an abort while a frame is being added cancels the output and rejects with the reason', async () => {
    const controller = new AbortController();
    const reason = new Error('stopped');
    const onProgress = vi.fn();
    fakes.hooks.source = made => made.add.mockImplementationOnce(() => new Promise((resolve, reject) => {
      made.pending = { resolve, reject };
    }));
    const encoding = encodeVideo({ frames: FRAMES, container: 'webm', onProgress, signal: controller.signal });
    await vi.waitFor(() => expect(source()?.pending).toBeTruthy());

    controller.abort(reason);

    await expect(encoding).rejects.toBe(reason);
    expect(onProgress).not.toHaveBeenCalled();
    expect(output().cancel).toHaveBeenCalled();
    expect(output().finalize).not.toHaveBeenCalled();
    expect(source().add).toHaveBeenCalledTimes(1);
    expect(allClosed()).toBe(true);
  });

  it('an abort while finalizing still rejects, once the file is finished', async () => {
    const controller = new AbortController();
    const reason = new Error('stopped');
    let finish;
    fakes.hooks.output = made => {
      made.finalize.mockImplementationOnce(() => new Promise(resolve => {
        finish = () => {
          made.state = 'finalized';
          resolve();
        };
      }));
      // A cancel doesn't stop a finalize() under way.
      made.cancel.mockImplementation(async () => {});
    };
    const encoding = encodeVideo({ frames: FRAMES, container: 'webm', signal: controller.signal });
    await vi.waitFor(() => expect(finish).toBeDefined());

    controller.abort(reason);
    finish();

    await expect(encoding).rejects.toBe(reason);
    // The listener's cancel only: a finished output isn't cancelled again.
    expect(output().cancel).toHaveBeenCalledTimes(1);
  });

  it('a stop while the encoder cleans up after its error keeps the error', async () => {
    const controller = new AbortController();
    const error = new Error('EncodingError');
    fakes.hooks.source = made => made.add.mockRejectedValueOnce(error);
    fakes.hooks.output = made => {
      const cancel = made.cancel.getMockImplementation();
      made.cancel.mockImplementation(async () => {
        controller.abort(new Error('stopped'));
        await cancel();
      });
    };

    await expect(encodeVideo({ frames: FRAMES, container: 'webm', signal: controller.signal })).rejects.toBe(error);
  });

  it('a stop while the codec is chosen rejects with the stop', async () => {
    const controller = new AbortController();
    const reason = new Error('stopped');
    canEncodeVideo.mockImplementation(async () => {
      controller.abort(reason);
      return false;
    });

    await expect(encodeVideo({ frames: FRAMES, container: 'webm', signal: controller.signal })).rejects.toBe(reason);
    expect(allClosed()).toBe(true);
  });

  it('an encoder error cancels the output and rejects with it', async () => {
    const error = new Error('EncodingError');
    fakes.hooks.source = made => made.add.mockResolvedValueOnce().mockRejectedValueOnce(error);

    await expect(encodeVideo({ frames: FRAMES, container: 'webm' })).rejects.toBe(error);
    expect(source().add).toHaveBeenCalledTimes(2);
    expect(output().state).toBe('canceled');
    expect(allClosed()).toBe(true);
  });
});

test.each(Object.keys(VIDEO_CONTAINERS))('fresh installs set %s to its container default, a codec it holds', container => {
  const codec = defaultSettings[codecSettingKey(container)];

  expect(codec).toBe(VIDEO_CONTAINERS[container].defaultCodec);
  expect(containerCodecs(container)).toContain(codec);
});
