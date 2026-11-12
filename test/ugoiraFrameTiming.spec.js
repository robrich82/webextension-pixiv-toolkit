/**
 * The ugoira conversions run through the bundled FFmpeg.wasm core (FFmpeg 5.1), timed with its
 * ffprobe. The download task's own spec fakes FFmpeg; this one checks what the real core does with
 * the input.txt and commands the task builds (#322: every delay used to be rounded to 40ms).
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import UgoiraDownloadTask from '@/options_page/modules/DownloadTasks/Pixiv/UgoiraDownloadTask';
import { UGOIRA_FFMPEG_CLI_ARGS } from '@/options_page/modules/DownloadAdapters/Pixiv/IllustAdapter';

const FORMATS = {
  gif: 'ugoiraFFmpegGIFCliArgs',
  apng: 'ugoiraFFmpegAPNGCliArgs',
  webm: 'ugoiraFFmpegWEBMCliArgs',
  mp4: 'ugoiraFFmpegMP4CliArgs'
};
const UNEVEN = [30, 70, 100, 50, 130, 60];
const EVEN = [70, 70, 70, 70];
// No common step of 10ms or more, so the tick is floored at 10ms.
const NEAR = [33, 34, 33, 33, 34, 33];
// Browsers play a 10ms animated-image frame for 100ms, so GIF and APNG get 20ms frames.
const FAST = [10, 10, 10, 10, 10, 10];

/** A command split the way the task splits it, with -safe 0 added the way the task adds it. */
const command = format => {
  const args = UGOIRA_FFMPEG_CLI_ARGS[FORMATS[format]].split(' ');
  UgoiraDownloadTask.allowConcatOptions(args);
  return args;
};

const input = (delays, format) => UgoiraDownloadTask.concatList(
  delays.map((delay, i) => ({ file: `${String(i).padStart(6, '0')}.jpg`, delay })),
  { minDelay: ['gif', 'apng'].includes(format) ? 20 : 0 }
);

const conversions = [
  ...Object.keys(FORMATS).map(format => ({ name: `${format} uneven`, input: input(UNEVEN, format), args: command(format) })),
  ...Object.keys(FORMATS).map(format => ({ name: `${format} even`, input: input(EVEN, format), args: command(format) })),
  ...['gif', 'mp4'].map(format => ({ name: `${format} near`, input: input(NEAR, format), args: command(format) })),
  ...['gif', 'apng'].map(format => ({ name: `${format} fast`, input: input(FAST, format), args: command(format) }))
];

/** @type {Record<string, { code: number, starts: number[], total: number }>} */
let results;

beforeAll(() => {
  // One process for every conversion: loading the 32MB core is the slow part.
  const stdout = execFileSync(process.execPath, [path.join(__dirname, 'helpers', 'ffmpegCore.cjs')], {
    input: JSON.stringify({ frames: UNEVEN.length, conversions }),
    maxBuffer: 1 << 24,
    timeout: 110000
  });
  const list = JSON.parse(stdout);

  results = Object.fromEntries(conversions.map(({ name }, i) => [name, list[i]]));
}, 120000);

test.each([
  ['gif', [0, 30, 100, 200, 250, 380]],
  // The APNG muxer drops the last frame, as it did before.
  ['apng', [0, 30, 100, 200, 250]],
  ['webm', [0, 30, 100, 200, 250, 380]],
  ['mp4', [0, 30, 100, 200, 250, 380]]
])('%s starts each frame after the delays before it, not on a 40ms step', (format, starts) => {
  expect(results[`${format} uneven`]).toMatchObject({ code: 0, starts });
});

test.each(['gif', 'webm', 'mp4'])('%s with equal delays shows every frame, the last too, for its delay', format => {
  expect(results[`${format} even`]).toEqual({ code: 0, starts: [0, 70, 140, 210], total: 280 });
});

test.each(['gif', 'mp4'])('%s starts each frame on the nearest 10ms when the delays share no 10ms step', format => {
  expect(results[`${format} near`]).toMatchObject({ code: 0, starts: [0, 30, 70, 100, 130, 170] });
});

// ffprobe reads a GIF delay under 20ms as 100ms, as browsers do, so 20ms steps prove the stored delays.
test.each([
  ['gif', [0, 20, 40, 60, 80, 100]],
  ['apng', [0, 20, 40, 60, 80]]
])('%s gives each frame under 20ms 20ms', (format, starts) => {
  expect(results[`${format} fast`]).toMatchObject({ code: 0, starts });
});
