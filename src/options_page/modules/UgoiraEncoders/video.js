import {
  BufferTarget,
  CanvasSource,
  MkvOutputFormat,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  canEncodeVideo
} from 'mediabunny';
import { VIDEO_CODECS, VIDEO_FORMAT_CODECS, codecSettingKey } from './codecs';
import { frameDelay } from './delay';

export { codecSettingKey };

/** The video containers ugoira convert to through WebCodecs. Their codecs are in VIDEO_FORMAT_CODECS. */
export const VIDEO_CONTAINERS = {
  webm: { createFormat: () => new WebMOutputFormat() },
  // MP4 and MOV put the index up front, so a player starts before it has all loaded.
  mp4: { createFormat: () => new Mp4OutputFormat({ fastStart: 'in-memory' }) },
  mov: { createFormat: () => new MovOutputFormat({ fastStart: 'in-memory' }) },
  mkv: { createFormat: () => new MkvOutputFormat() }
};

const QUALITY = new Quality('very-high');

/** H.264 and H.265 encoders refuse odd dimensions. */
const EVEN_DIMENSION_CODECS = ['avc', 'hevc'];

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
      if (codec !== preferred) {
        console.info(`Encoding ${container} as ${codec}: this browser can't encode ${preferred} at ${size.width}x${size.height}`);
      }

      return codec;
    }
  }

  // Mediabunny remembers a failed check until the download manager is reloaded.
  throw new Error(`This browser can't encode ${container.toUpperCase()} video at ${size.width}x${size.height} ` +
    `(tried ${candidates.join(', ')}). Reload the download manager and retry, or download another format.`);
}

/**
 * Each frame's start and length in seconds, from the delays in ms.
 * @param {{ delay: number }[]} frames
 * @returns {{ timestamp: number, duration: number }[]}
 */
export function frameTimes(frames) {
  let elapsed = 0;

  return frames.map(({ delay }) => {
    const ms = frameDelay(delay);
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
 * @param {string} [options.codec] The codec to use if the browser can; the container's default when
 *   it can't, or when the container can't hold it
 * @param {(choice: { codec: string, fallback: boolean }) => void} [options.onCodec] With the codec chosen,
 *   before encoding starts; `fallback` when this browser can't encode the one asked for
 * @param {(progress: number) => void} [options.onProgress] With the share of frames encoded
 * @param {AbortSignal} [options.signal] Cancels the encoding, which then rejects
 * @returns {Promise<{ data: ArrayBuffer, mimeType: string, extension: string, codec: string }>}
 */
export async function encodeVideo({ frames, container, codec, onCodec, onProgress, signal }) {
  const { createFormat } = VIDEO_CONTAINERS[container];
  const { defaultCodec } = VIDEO_FORMAT_CODECS[container];
  const times = frameTimes(frames);
  let bitmap = await createImageBitmap(frames[0].image);
  const size = { width: bitmap.width, height: bitmap.height };
  let chosen, width, height, context, format, output, source;

  try {
    // A stored codec the container can't hold reads as its default, as on the settings page.
    const preferred = containerCodecs(container).includes(codec) ? codec : defaultCodec;
    chosen = await chooseCodec(container, preferred, size);
    onCodec?.({ codec: chosen, fallback: chosen !== preferred });
    ({ width, height } = encodedSize(chosen, size));
    const canvas = new OffscreenCanvas(width, height);
    context = canvas.getContext('2d');
    format = createFormat();
    output = new Output({ format, target: new BufferTarget() });
    source = new CanvasSource(canvas, { codec: chosen, quality: QUALITY });
    output.addVideoTrack(source);
  } catch (error) {
    bitmap.close();
    throw signal?.aborted ? signal.reason : error;
  }

  // A pending add() returns early and a finalize() under way finishes, so the abort is checked after each.
  const cancel = () => {
    if (output.state !== 'finalized') {
      output.cancel().catch(() => {});
    }
  };

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
    // Read before the cancel below, so a stop during it doesn't replace a real error.
    const aborted = signal?.aborted;

    bitmap?.close();

    if (output.state !== 'canceled' && output.state !== 'finalized') {
      await output.cancel();
    }

    throw aborted ? signal.reason : error;
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
