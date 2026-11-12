/**
 * The ugoira conversions run through the bundled FFmpeg.wasm core (FFmpeg 5.1), timed with its
 * ffprobe. The download task's own spec fakes FFmpeg; this one checks what the real core does with
 * the input.txt and commands the task builds: each frame lasts its own delay (#322), the last
 * frame too (#325).
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

// A long last frame, which the concat demuxer would cut to one tick (#325).
const HOLD = [100, 100, 1000];

/** A conversion of the delays with `command`, readied the way runFFmpeg readies it. */
const conversion = (name, command, delays) => {
  const frames = delays.map((delay, i) => ({ file: `${String(i).padStart(6, '0')}.jpg`, delay }));
  const args = command.split(' ');
  const input = UgoiraDownloadTask.prepareConversion([args], frames);

  return { name, input, args };
};
const preset = (name, format, delays) =>
  conversion(`${format} ${name}`, UGOIRA_FFMPEG_CLI_ARGS[FORMATS[format]], delays);

const ALL = Object.keys(FORMATS);
const conversions = [
  ...ALL.map(format => preset('uneven', format, UNEVEN)),
  ...ALL.map(format => preset('even', format, EVEN)),
  ...ALL.map(format => preset('hold', format, HOLD)),
  ...['gif', 'mp4'].map(format => preset('near', format, NEAR)),
  ...['gif', 'apng'].map(format => preset('fast', format, FAST)),
  conversion('apng named .png', '-f concat -i input.txt -plays 0 -f apng out.png', HOLD),
  conversion('gif named .img', '-f concat -i input.txt -f gif out.img', HOLD)
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

// A video ends with a repeat of the last frame, one tick before the end (#325).
test.each([
  ['gif', [0, 30, 100, 200, 250, 380]],
  ['apng', [0, 30, 100, 200, 250, 380]],
  ['webm', [0, 30, 100, 200, 250, 380, 430]],
  ['mp4', [0, 30, 100, 200, 250, 380, 430]]
])('%s shows each frame for its own delay, the last too', (format, starts) => {
  expect(results[`${format} uneven`]).toEqual({ code: 0, starts, total: 440 });
});

test.each(ALL)('%s with equal delays shows every frame for its delay', format => {
  expect(results[`${format} even`]).toEqual({ code: 0, starts: [0, 70, 140, 210], total: 280 });
});

test.each([
  ['gif', [0, 100, 200]],
  ['apng', [0, 100, 200]],
  ['webm', [0, 100, 200, 1100]],
  ['mp4', [0, 100, 200, 1100]]
])('%s holds a long last frame for its delay', (format, starts) => {
  expect(results[`${format} hold`]).toEqual({ code: 0, starts, total: 1200 });
});

test.each(['apng named .png', 'gif named .img'])('a custom command whose -f picks the format holds the last frame (%s)', name => {
  expect(results[name]).toEqual({ code: 0, starts: [0, 100, 200], total: 1200 });
});

test.each([
  ['gif', [0, 30, 70, 100, 130, 170]],
  ['mp4', [0, 30, 70, 100, 130, 170, 190]]
])('%s starts each frame on the nearest 10ms when the delays share no 10ms step', (format, starts) => {
  expect(results[`${format} near`]).toEqual({ code: 0, starts, total: 200 });
});

// ffprobe reads a GIF delay under 20ms as 100ms, as browsers do, so 20ms steps prove the stored delays.
test.each(['gif', 'apng'])('%s gives each frame under 20ms 20ms', format => {
  expect(results[`${format} fast`]).toEqual({ code: 0, starts: [0, 20, 40, 60, 80, 100], total: 120 });
});
