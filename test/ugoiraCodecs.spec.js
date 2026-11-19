import { Quality, canEncodeVideo } from 'mediabunny';
import { VIDEO_CODECS, codecSettingKey, encodableCodecs } from '@/options_page/modules/UgoiraEncoders/codecs';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Stubs VideoEncoder with the given isConfigSupported, and returns the mock. */
function stubEncoder(isConfigSupported) {
  vi.stubGlobal('VideoEncoder', { isConfigSupported: vi.fn(isConfigSupported) });

  return globalThis.VideoEncoder.isConfigSupported;
}

describe('encodableCodecs', () => {
  test('reports each codec the way the browser answers for it', async () => {
    stubEncoder(async ({ codec }) => ({ supported: codec === 'vp8' || codec.startsWith('vp09.') }));

    expect(await encodableCodecs()).toEqual({ avc: false, vp9: true, av1: false, hevc: false, vp8: true });
  });

  test('asks once per codec, at a 1920x1080 frame', async () => {
    const isConfigSupported = stubEncoder(async () => ({ supported: true }));

    expect(await encodableCodecs()).toEqual(Object.fromEntries(VIDEO_CODECS.map(codec => [codec, true])));
    expect(isConfigSupported).toHaveBeenCalledTimes(VIDEO_CODECS.length);
    for (const [config] of isConfigSupported.mock.calls) {
      expect(config).toMatchObject({ width: 1920, height: 1080 });
    }
  });

  test('a codec whose check rejects counts as unencodable, says so, and leaves the others', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubEncoder(async ({ codec }) => {
      if (codec.startsWith('hvc1.')) {
        throw new TypeError('invalid codec');
      }

      return { supported: true };
    });

    expect(await encodableCodecs()).toMatchObject({ hevc: false, avc: true, vp9: true });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('hevc');
  });

  test('without WebCodecs, no codec is encodable', async () => {
    const warn = vi.spyOn(console, 'warn');
    vi.stubGlobal('VideoEncoder', undefined);

    expect(Object.values(await encodableCodecs())).toEqual(VIDEO_CODECS.map(() => false));
    expect(warn).not.toHaveBeenCalled();
  });

  // No browser in CI encodes H.265, so the e2e tests can't tell a wrong string from a real "no".
  test('asks with the codec strings Mediabunny asks with at 1920x1080', async () => {
    const isConfigSupported = stubEncoder(async () => ({ supported: true }));
    const askedFor = () => isConfigSupported.mock.calls.map(([config]) => config.codec);

    await encodableCodecs();
    const ours = askedFor();

    for (const [i, codec] of VIDEO_CODECS.entries()) {
      isConfigSupported.mockClear();
      await canEncodeVideo(codec, { width: 1920, height: 1080, quality: new Quality('very-high') });
      expect(askedFor()[0], codec).toBe(ours[i]);
    }
  });
});

test('names each format\'s codec setting', () => {
  expect(['webm', 'mp4', 'mov', 'mkv'].map(codecSettingKey))
    .toEqual(['ugoiraWEBMCodec', 'ugoiraMP4Codec', 'ugoiraMOVCodec', 'ugoiraMKVCodec']);
});
