/**
 * The WebCodecs ugoira encoder's choices, against the real Mediabunny output formats. Node has no
 * VideoEncoder, so which codecs "encode" is faked through canEncodeVideo; e2e/ugoira.e2e.js and
 * e2e-firefox/downloads.test.mjs run the real encode.
 */
import { canEncodeVideo } from 'mediabunny';
import {
  FALLBACK_DELAY, chooseCodec, containerCodecs, encodedSize, frameTimes
} from '@/options_page/modules/UgoiraEncoders/video';

vi.mock('mediabunny', async importOriginal => ({
  ...await importOriginal(),
  canEncodeVideo: vi.fn()
}));

/** Lets the browser encode only these codecs. */
const encodable = (...codecs) => canEncodeVideo.mockImplementation(async codec => codecs.includes(codec));

beforeEach(() => {
  canEncodeVideo.mockReset();
});

describe('containerCodecs', () => {
  it('offers the codecs WebM holds, H.264 and H.265 not among them', () => {
    expect(containerCodecs('webm')).toEqual(['vp9', 'av1', 'vp8']);
  });
});

describe('chooseCodec', () => {
  it('uses the preferred codec when the browser can encode it', async () => {
    encodable('vp9', 'vp8');

    expect(await chooseCodec('webm', 'vp9', { width: 16, height: 16 })).toBe('vp9');
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
    encodable('vp9');

    await chooseCodec('webm', 'vp9', { width: 15, height: 9 });

    expect(canEncodeVideo).toHaveBeenCalledWith('vp9', expect.objectContaining({ width: 15, height: 9 }));
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
