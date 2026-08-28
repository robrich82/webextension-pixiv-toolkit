/**
 * `Util/APNG` is UPNG with its encoder replaced: the same chunk assembly, plus
 * the progress and debug hooks `APngGenerator.worker.js` reports through. It
 * works on raw RGBA buffers and pako, with no canvas anywhere, so it can be run
 * for real here rather than mocked.
 *
 * The tests round-trip through UPNG's own decoder — encode frames, decode the
 * bytes back, compare pixels — which covers what the worker depends on, that an
 * animation survives the trip, without pinning byte offsets that any honest
 * change to the encoder would break.
 *
 * Frames are 32x32 because the encoder sizes its scratch buffer from the frame
 * data alone; see 'a frame too small for the chunk overhead' below for what
 * happens under that.
 */
const UPNG = require('upng-js');
const APNG = require('../src/modules/Util/APNG').default;

const WIDTH = 32;
const HEIGHT = 32;

/** A solid `[r, g, b, a]` frame of `width * height`, as the ArrayBuffer `encode` expects. */
function solidFrame([r, g, b, a] = [0, 0, 0, 255], width = WIDTH, height = HEIGHT) {
  const pixels = new Uint8Array(width * height * 4);

  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = a;
  }

  return pixels.buffer;
}

/** A frame with one pixel of its own, to give the inter-frame diffing something to find. */
function frameWithDot(fill, dot, index = 0) {
  const pixels = new Uint8Array(solidFrame(fill));

  pixels.set(dot, index * 4);

  return pixels.buffer;
}

const asBytes = buffer => Array.from(new Uint8Array(buffer));

/** The frames of an encoded APNG, composited and flattened to byte arrays. */
function decodeFrames(buffer) {
  const image = UPNG.decode(buffer);

  return { image, frames: UPNG.toRGBA8(image).map(asBytes) };
}

/** Whether a PNG chunk of this name appears in the encoded bytes. */
function hasChunk(buffer, name) {
  const bytes = new Uint8Array(buffer);
  const marker = Array.from(name, character => character.charCodeAt(0));

  return bytes.some((_, index) => marker.every((code, offset) => bytes[index + offset] === code));
}

let log;

beforeEach(() => {
  // `APNG.debug` logs on every encode (see 'debug output'), which would other-
  // wise bury the report.
  log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  log.mockRestore();
});

describe('encoding a still image', () => {
  test('round-trips the pixels of a single frame', () => {
    const source = frameWithDot([255, 0, 0, 255], [0, 0, 255, 255]);

    const { image, frames } = decodeFrames(APNG.encode([source], WIDTH, HEIGHT, 0, [0]));

    expect(image.width).toBe(WIDTH);
    expect(image.height).toBe(HEIGHT);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(asBytes(source));
  });

  test('writes the PNG signature and the chunks a decoder needs', () => {
    const encoded = APNG.encode([solidFrame([1, 2, 3, 255])], WIDTH, HEIGHT, 0, [0]);

    expect(asBytes(encoded).slice(0, 8)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(hasChunk(encoded, 'IHDR')).toBe(true);
    expect(hasChunk(encoded, 'IDAT')).toBe(true);
    expect(hasChunk(encoded, 'IEND')).toBe(true);
  });

  test('leaves out the animation chunks for a single frame', () => {
    const encoded = APNG.encode([solidFrame([1, 2, 3, 255])], WIDTH, HEIGHT, 0, [0]);

    expect(hasChunk(encoded, 'acTL')).toBe(false);
    expect(hasChunk(encoded, 'fcTL')).toBe(false);
  });

  test('round-trips a frame of many colours, which is the truecolour path', () => {
    // Over 256 colours there is no palette to write, so the frame goes out as
    // RGBA rather than indexed.
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);

    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = (i / 4) % 256;
      pixels[i + 1] = (i / 4 * 7) % 256;
      pixels[i + 2] = (i / 4 * 13) % 256;
      pixels[i + 3] = 255;
    }

    const encoded = APNG.encode([pixels.buffer], WIDTH, HEIGHT, 0, [0]);

    expect(hasChunk(encoded, 'PLTE')).toBe(false);
    expect(decodeFrames(encoded).frames[0]).toEqual(Array.from(pixels));
  });
});

describe('encoding an animation', () => {
  const frames = [
    frameWithDot([255, 0, 0, 255], [0, 0, 255, 255], 0),
    frameWithDot([255, 0, 0, 255], [0, 0, 255, 255], 5),
    frameWithDot([0, 255, 0, 255], [0, 0, 255, 255], 10)
  ];
  const delays = [40, 40, 120];

  test('round-trips every frame', () => {
    const { image, frames: decoded } = decodeFrames(APNG.encode(frames, WIDTH, HEIGHT, 0, delays));

    expect(image.frames).toHaveLength(3);
    expect(decoded).toEqual(frames.map(asBytes));
  });

  test('keeps each frame delay', () => {
    const { image } = decodeFrames(APNG.encode(frames, WIDTH, HEIGHT, 0, delays));

    expect(image.frames.map(frame => frame.delay)).toEqual(delays);
  });

  test('writes the animation chunks, carrying later frames as fdAT', () => {
    const encoded = APNG.encode(frames, WIDTH, HEIGHT, 0, delays);

    expect(hasChunk(encoded, 'acTL')).toBe(true);
    expect(hasChunk(encoded, 'fcTL')).toBe(true);
    expect(hasChunk(encoded, 'fdAT')).toBe(true);
  });

  test('stores a later frame as the region that changed', () => {
    // The point of the diffing in `compress`: a frame differing in one pixel is
    // written as a sub-rectangle, not as another full-size image.
    const { image } = decodeFrames(APNG.encode(frames, WIDTH, HEIGHT, 0, delays));

    expect(image.frames[0].rect).toMatchObject({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
    expect(image.frames[1].rect.width * image.frames[1].rect.height).toBeLessThan(WIDTH * HEIGHT);
  });

  test('round-trips frames carrying transparency', () => {
    const transparent = [
      frameWithDot([255, 0, 0, 255], [0, 0, 0, 0], 0),
      frameWithDot([255, 0, 0, 255], [0, 0, 0, 0], 5)
    ];

    const { frames: decoded } = decodeFrames(APNG.encode(transparent, WIDTH, HEIGHT, 0, [40, 40]));

    expect(decoded).toEqual(transparent.map(asBytes));
  });

  test('round-trips with the palette forbidden', () => {
    const encoded = APNG.encode(frames, WIDTH, HEIGHT, 0, delays, true);

    expect(hasChunk(encoded, 'PLTE')).toBe(false);
    expect(decodeFrames(encoded).frames).toEqual(frames.map(asBytes));
  });

  test('a frame identical to the one before it still decodes to the same pixels', () => {
    const still = solidFrame([12, 34, 56, 255]);

    const { frames: decoded } = decodeFrames(APNG.encode([still, still], WIDTH, HEIGHT, 0, [40, 40]));

    expect(decoded).toEqual([asBytes(still), asBytes(still)]);
  });
});

describe('the scratch buffer', () => {
  test('a frame too small for the chunk overhead is written past the end of the buffer', () => {
    // `encode` sizes its buffer as `frameBytes * frameCount + 100`, which counts
    // only the pixel data. The per-frame fcTL and fdAT headers are about 64
    // bytes each on top, so a small enough animation runs past the end — writes
    // to a Uint8Array beyond its length are dropped silently, and what comes
    // back is a truncated file with no IEND. Ugoira frames are nowhere near
    // this small, but a spec that reaches for a 4x4 fixture will hit it.
    const tiny = [solidFrame([255, 0, 0, 255], 4, 4), solidFrame([0, 255, 0, 255], 4, 4)];

    const encoded = APNG.encode(tiny, 4, 4, 0, [40, 40]);

    expect(hasChunk(encoded, 'IEND')).toBe(false);
    expect(UPNG.decode(encoded).data).toBeUndefined();
  });
});

describe('progress reporting', () => {
  let progress;
  let listener;

  beforeEach(() => {
    progress = [];
    listener = (current, total) => progress.push([current, total]);

    APNG.event.addListener('onProgress', listener);
  });

  afterEach(() => {
    // `APNG` is a module-level singleton, so a listener left attached would go
    // on collecting through the rest of the file.
    APNG.event.removeListener('onProgress', listener);
  });

  /** Report an encode, from a counter left where the previous encode ended. */
  function encodeTwice() {
    APNG.encode([solidFrame([1, 2, 3, 255]), solidFrame([3, 2, 1, 255])], WIDTH, HEIGHT, 0, [40, 40]);

    progress.length = 0;

    APNG.encode([solidFrame([1, 2, 3, 255]), solidFrame([3, 2, 1, 255])], WIDTH, HEIGHT, 0, [40, 40]);

    return progress;
  }

  test('reports every step against a total of 1000', () => {
    const reported = encodeTwice();

    expect(reported.length).toBeGreaterThan(1);
    expect(reported.every(([, total]) => total === 1000)).toBe(true);
  });

  test('finishes on the total, whatever it counted along the way', () => {
    // `complete()` snaps the counter to the total, which is what the worker's
    // progress bar ends on.
    expect(encodeTwice().pop()).toEqual([1000, 1000]);
  });

  test('carries the count over from the previous encode instead of restarting', () => {
    // `setTotalProgress` clears the stages but not `currentProgress`, so every
    // encode after the first counts up from where the last one finished — 1000,
    // the total — and reports progress beyond 100% until `complete()` pulls it
    // back. One encode per worker is why this has not shown up in the UI.
    const reported = encodeTwice().map(([current]) => current);

    expect(reported[0]).toBeGreaterThan(1000);
    expect(reported.slice(0, -1).every((value, index, values) => index === 0 || value > values[index - 1])).toBe(true);
    expect(reported[reported.length - 1]).toBe(1000);
  });

  test('rejects a stage registered twice, so a duplicate cannot skew the count', () => {
    APNG.progress.setTotalProgress(1000);
    APNG.progress.setStageTargetProgress('compress', 100, 1);

    expect(() => APNG.progress.setStageTargetProgress('compress', 100, 1))
      .toThrow('duplicated progress stage "compress"');
  });

  test('rejects a step against a stage that was never registered', () => {
    APNG.progress.setTotalProgress(1000);

    expect(() => APNG.progress.nextStageStep('nope')).toThrow('unkown progress stage "nope"');
  });
});

describe('debug output', () => {
  let enableAsDeclared;

  beforeEach(() => {
    enableAsDeclared = APNG.debug.enable;
  });

  afterEach(() => {
    // Both switches below overwrite `enable` itself, so put it back — the rest
    // of the file assumes the state the module was loaded in.
    APNG.debug.enable = enableAsDeclared;
  });

  test('logs on every encode, although it reads as switched off', () => {
    // `APNG.debug` declares `enable: false` and then a method of the same name,
    // so the method wins and the flag every guard tests — `if (!this.enable)
    // return;` — is a function, which is never falsy. `APngGenerator.worker.js`
    // keeps its `APNG.debug.enable()` call commented out on the understanding
    // that debug is off; it is not.
    APNG.encode([solidFrame([1, 2, 3, 255])], WIDTH, HEIGHT, 0, [40]);

    expect(typeof enableAsDeclared).toBe('function');
    expect(log).toHaveBeenCalled();
    expect(log.mock.calls.some(([first]) => String(first).startsWith('current progress'))).toBe(true);
  });

  test('disable() silences it, by writing the flag the method was shadowing', () => {
    APNG.debug.disable();

    APNG.encode([solidFrame([1, 2, 3, 255])], WIDTH, HEIGHT, 0, [40]);

    expect(APNG.debug.enable).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  test('enable() writes over itself, so it can only ever be called once', () => {
    APNG.debug.enable();

    expect(APNG.debug.enable).toBe(true);
    expect(() => APNG.debug.enable()).toThrow(TypeError);
  });
});

describe('what it inherits from UPNG', () => {
  test('the decoder comes straight from UPNG', () => {
    expect(APNG.decode).toBe(UPNG.decode);
    expect(APNG.toRGBA8).toBe(UPNG.toRGBA8);
  });

  test('the encoder is its own, leaving UPNG untouched for anything else importing it', () => {
    expect(APNG.encode).not.toBe(UPNG.encode);
  });
});
