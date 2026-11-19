/**
 * The video formats and codecs, without Mediabunny, so the settings page can list them without
 * bundling it. video.js checks the table against Mediabunny's formats (test/ugoiraVideoEncoder.spec.js).
 */

/** The codecs offered, in the order a fallback tries them. */
export const VIDEO_CODECS = ['avc', 'vp9', 'av1', 'hevc', 'vp8'];

/** Each video format's offered codecs, in VIDEO_CODECS order, and the one it uses by default. */
export const VIDEO_FORMAT_CODECS = {
  webm: { codecs: ['vp9', 'av1', 'vp8'], defaultCodec: 'vp9' },
  mp4: { codecs: VIDEO_CODECS, defaultCodec: 'avc' },
  mov: { codecs: VIDEO_CODECS, defaultCodec: 'avc' },
  mkv: { codecs: VIDEO_CODECS, defaultCodec: 'avc' }
};

export const CODEC_LABELS = {
  avc: 'H.264 (AVC)',
  hevc: 'H.265 (HEVC)',
  vp9: 'VP9',
  av1: 'AV1',
  vp8: 'VP8'
};

/**
 * @param {string} container A key of VIDEO_FORMAT_CODECS
 * @returns {string} The setting holding the codec the container tries first
 */
export const codecSettingKey = container => `ugoira${container.toUpperCase()}Codec`;

/**
 * Codec strings for an 8-bit 1920x1080 encode, the way Mediabunny writes them. Mediabunny picks the
 * level from the real size and bitrate, so this only approximates what a conversion asks for.
 */
const PROBE_CODEC_STRINGS = {
  avc: 'avc1.640028',
  hevc: 'hvc1.1.6.L120.B0',
  vp9: 'vp09.00.40.08',
  av1: 'av01.0.08M.08',
  vp8: 'vp8'
};

/**
 * Asks the browser's WebCodecs which codecs it can encode. Firefox over-reports H.264 for small
 * frames, which the encode-time fallback covers.
 * @returns {Promise<Object<string, boolean>>} Each of VIDEO_CODECS, true when it can be encoded
 */
export async function encodableCodecs() {
  const entries = await Promise.all(VIDEO_CODECS.map(async codec => {
    try {
      const { supported } = await globalThis.VideoEncoder.isConfigSupported({
        codec: PROBE_CODEC_STRINGS[codec], width: 1920, height: 1080
      });

      return [codec, supported === true];
    } catch {
      // No VideoEncoder, or it rejects the config outright.
      return [codec, false];
    }
  }));

  return Object.fromEntries(entries);
}
