import {
  BufferTarget,
  CanvasSource,
  Output,
  Quality,
  WebMOutputFormat,
  canEncodeVideo
} from 'mediabunny';

/**
 * The video containers ugoira convert to through WebCodecs, each with the codec used unless the
 * browser can't encode it.
 */
export const VIDEO_CONTAINERS = {
  webm: { createFormat: () => new WebMOutputFormat(), defaultCodec: 'vp9' }
};

const QUALITY = new Quality('very-high');

/** The codecs offered, in the order a fallback tries them. */
export const VIDEO_CODECS = ['avc', 'vp9', 'av1', 'hevc', 'vp8'];

/** H.264 and H.265 encoders refuse odd dimensions. */
const EVEN_DIMENSION_CODECS = ['avc', 'hevc'];

/** A frame whose delay isn't a positive number of ms (Pixiv always gives one) lasts this long. */
export const FALLBACK_DELAY = 100;

/**
 * @param {string} container
 * @returns {string[]} The offered codecs the container can hold
 */
export function containerCodecs(container) {
  const supported = VIDEO_CONTAINERS[container].createFormat().getSupportedVideoCodecs();

  return VIDEO_CODECS.filter(codec => supported.includes(codec));
}

/**
 * @param {string} codec
 * @param {{ width: number, height: number }} size
 * @returns {{ width: number, height: number }} The size the codec encodes the frames at
 */
export function encodedSize(codec, { width, height }) {
  if (!EVEN_DIMENSION_CODECS.includes(codec)) {
    return { width, height };
  }

  return { width: width + (width % 2), height: height + (height % 2) };
}

/**
 * The preferred codec when this browser can encode it at this size, or else the first offered codec
 * the container holds that it can.
 * @param {string} container
 * @param {string} preferred
 * @param {{ width: number, height: number }} size
 * @returns {Promise<string>}
 */
export async function chooseCodec(container, preferred, size) {
  const codecs = containerCodecs(container);
  const candidates = codecs.includes(preferred) ?
    [preferred, ...codecs.filter(codec => codec !== preferred)] :
    codecs;

  // One at a time: odd sizes encode at a different size per codec (encodedSize).
  for (const codec of candidates) {
    if (await canEncodeVideo(codec, { ...encodedSize(codec, size), quality: QUALITY })) {
      return codec;
    }
  }

  throw new Error(`This browser can't encode ${container.toUpperCase()} video at ${size.width}x${size.height}`);
}

/**
 * Each frame's start and length in seconds, from the delays in ms.
 * @param {{ delay: number }[]} frames
 * @returns {{ timestamp: number, duration: number }[]}
 */
export function frameTimes(frames) {
  let elapsed = 0;

  return frames.map(({ delay }) => {
    const ms = Number.isFinite(delay) && delay > 0 ? delay : FALLBACK_DELAY;
    const time = { timestamp: elapsed / 1000, duration: ms / 1000 };

    elapsed += ms;

    return time;
  });
}

/**
 * Encodes the frames, each shown for its own delay, as a video.
 * @param {object} options
 * @param {{ image: Blob, delay: number }[]} options.frames JPEG or PNG frames, all one size
 * @param {string} options.container A key of VIDEO_CONTAINERS
 * @param {string} [options.codec] The codec to use if the browser can; the container's default otherwise
 * @param {(progress: number) => void} [options.onProgress] With the share of frames encoded
 * @param {AbortSignal} [options.signal] Cancels the encoding, which then rejects
 * @returns {Promise<{ data: ArrayBuffer, mimeType: string, extension: string, codec: string }>}
 */
export async function encodeVideo({ frames, container, codec, onProgress, signal }) {
  const { createFormat, defaultCodec } = VIDEO_CONTAINERS[container];
  const times = frameTimes(frames);
  let bitmap = await createImageBitmap(frames[0].image);
  const size = { width: bitmap.width, height: bitmap.height };
  let chosen;

  try {
    chosen = await chooseCodec(container, codec || defaultCodec, size);
  } catch (error) {
    bitmap.close();
    throw error;
  }

  const { width, height } = encodedSize(chosen, size);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  const format = createFormat();
  const output = new Output({ format, target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec: chosen, quality: QUALITY });
  // A pending add() then rejects; a finalize() under way finishes, so the abort is checked after it.
  const cancel = () => output.cancel().catch(() => {});

  output.addVideoTrack(source);
  signal?.addEventListener('abort', cancel);

  try {
    signal?.throwIfAborted();
    await output.start();

    for (let i = 0; i < frames.length; i++) {
      bitmap ??= await createImageBitmap(frames[i].image);
      // The pad an even size adds stays black, as FFmpeg's did.
      context.fillStyle = '#000';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      bitmap = null;

      signal?.throwIfAborted();
      await source.add(times[i].timestamp, times[i].duration);
      signal?.throwIfAborted();
      onProgress?.((i + 1) / frames.length);
    }

    signal?.throwIfAborted();
    await output.finalize();
    signal?.throwIfAborted();
  } catch (error) {
    bitmap?.close();

    if (output.state !== 'canceled' && output.state !== 'finalized') {
      await output.cancel();
    }

    throw signal?.aborted ? signal.reason : error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }

  return {
    data: output.target.buffer,
    mimeType: format.mimeType,
    extension: format.fileExtension.replace(/^\./, ''),
    codec: chosen
  };
}
