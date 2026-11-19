/**
 * UgoiraDownloadTask driving a real Downloader and the real JSZip the download
 * manager page loads. The background's end of the `DownloadFile` port is the
 * network stand-in, and FFmpeg.wasm and the WebCodecs encoder are fakes that record what they
 * are asked to do; e2e/ugoira.e2e.js runs the real conversion.
 */
import RealJSZip from 'jszip/dist/jszip.min.js';
import browser from './doubles/browser';
import { fakeDownloadFileBackground } from './helpers/downloadFileBackground';
import UgoiraDownloadTask, { ZipRepo } from '@/options_page/modules/DownloadTasks/Pixiv/UgoiraDownloadTask';
import DownloadManager from '@/options_page/modules/DownloadManager';
import { encodeVideo } from '@/options_page/modules/UgoiraEncoders/video';
import { encodeGif } from '@/options_page/modules/UgoiraEncoders/gif';

// Node has no WebCodecs; test/ugoiraVideoEncoder.spec.js and the e2e tests cover the encoder.
vi.mock('@/options_page/modules/UgoiraEncoders/video', async importOriginal => ({
  ...await importOriginal(),
  encodeVideo: vi.fn()
}));
// Node has no Worker or OffscreenCanvas; test/ugoiraGifEncoder.spec.js and the e2e tests cover the encoder.
vi.mock('@/options_page/modules/UgoiraEncoders/gif', async importOriginal => ({
  ...await importOriginal(),
  encodeGif: vi.fn()
}));

const resourceUrl = id => `https://i.pximg.net/img-zip-ugoira/img/${id}_ugoira1920x1080.zip`;
const frames = [{ file: '000000.jpg', delay: 100 }, { file: '000001.jpg', delay: 250 }];
// The tasks convert through FFmpeg by default: APNG still does, GIF and video encode in the browser.
const APNG_COMMAND = '-f concat -i input.txt -plays 0 output.apng';

let background;
let saved;
let ffmpegs;
let nextId = 1000;

class FakeFFmpeg {
  files = new Map();
  listeners = {};
  commands = [];
  deleted = [];
  terminated = false;
  /** Set to a promise to hold the next exec until it settles. */
  static execGate;

  constructor() {
    ffmpegs.push(this);
  }

  on(event, listener) {
    this.listeners[event] = listener;
  }

  async load() {}

  async writeFile(name, data) {
    this.files.set(name, data);
  }

  async exec(args) {
    this.commands.push(args);
    this.listeners.progress?.({ progress: 0.5 });
    const gate = FakeFFmpeg.execGate;
    FakeFFmpeg.execGate = undefined;

    if (gate) {
      await Promise.race([gate, new Promise((resolve, reject) => (this.rejectPending = reject))]);
    }

    this.files.set(args[args.length - 1], new Uint8Array([1, 2, 3]));
  }

  async readFile(name) {
    return this.files.get(name);
  }

  async deleteFile(name) {
    this.deleted.push(name);
  }

  terminate() {
    this.terminated = true;
    this.rejectPending?.(new Error('called FFmpeg.terminate()'));
  }
}

const framesZip = async () => {
  const zip = new RealJSZip();
  frames.forEach((frame, i) => zip.file(frame.file, `frame ${i}`));
  return zip.generateAsync({ type: 'nodebuffer' });
};

const createTask = ({ id = `${nextId++}`, taskId = `pixiv:${id}:apng`, ...options } = {}) => UgoiraDownloadTask.create({
  uid: `pixiv:${id}`,
  id: taskId,
  url: `https://www.pixiv.net/artworks/${id}`,
  resource: resourceUrl(id),
  frames,
  packAnimationJsonType: 0,
  renameRule: '{id}_{title}',
  ffmpegCommandArgs: APNG_COMMAND,
  convertType: 'apng',
  context: {
    id,
    title: 'Moving',
    illustSrc: 'https://i.pximg.net/small.zip',
    illustOriginalSrc: resourceUrl(id),
    illustMimeType: 'image/jpeg',
    illustFrames: frames
  },
  ...options
});

/** Answers the task's frames zip request. */
const completeDownload = async task => {
  await vi.waitFor(() => expect(background.request(task.options.resource)).toBeDefined());
  background.request(task.options.resource).complete(await framesZip(), 'application/zip');
};

const savedNames = () => saved.map(file => file.filename);

const events = task => {
  const fired = [];

  for (const name of ['start', 'complete', 'failure', 'pause']) {
    task.addListener(name, () => fired.push(name));
  }

  return fired;
};

beforeEach(() => {
  window.$app = {
    settings: { downloadTasksWhenDownloadingImages: 1, downloadRelativeLocation: 'ugoira', enableDownloadMetadata: false }
  };
  globalThis.JSZip = RealJSZip;
  globalThis.FFmpegWASM = { FFmpeg: FakeFFmpeg };
  FakeFFmpeg.execGate = undefined;
  // runFFmpeg logs each command and FFmpeg log line.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  ffmpegs = [];
  saved = [];
  background = fakeDownloadFileBackground();

  // Read each saved blob while its object url is still alive.
  const createObjectURL = URL.createObjectURL;
  const blobs = new Map();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    const url = createObjectURL(blob);
    blobs.set(url, blob);
    return url;
  });
  // Records each save; fakeDownloadFileBackground answers it.
  browser.runtime.onMessage.addListener(message => {
    if (message.to === 'ws' && message.action === 'download:saveFile') {
      saved.push({ url: message.args.url, filename: message.args.filename, blob: blobs.get(message.args.url) });
    }
  });
});

afterEach(() => {
  delete window.$app;
  delete globalThis.JSZip;
  delete globalThis.FFmpegWASM;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('converts the frames and saves only the animation, not the frames zip', async () => {
  const task = createTask({ id: '123' });
  const fired = events(task);

  task.start();
  expect(task.isDownloading()).toBe(true);
  await completeDownload(task);
  await vi.waitFor(() => expect(task.isComplete()).toBe(true));

  expect(savedNames()).toEqual(['ugoira/123_Moving.apng']);
  expect(saved[0].blob.type).toBe('image/apng');

  const [ffmpeg] = ffmpegs;
  expect(new TextDecoder().decode(ffmpeg.files.get('000001.jpg'))).toBe('frame 1');
  // 100ms and 250ms are both whole 50ms ticks, so neither is rounded (#322).
  expect(ffmpeg.files.get('input.txt')).toBe(
    "file '000000.jpg'\r\noption framerate 1000/50\r\nduration 0.1\r\n" +
    "file '000001.jpg'\r\noption framerate 1000/50\r\nduration 0.25\r\n"
  );
  expect(ffmpeg.commands)
    .toEqual([['-f', 'concat', '-safe', '0', '-i', 'input.txt', '-plays', '0', '-final_delay', '250/1000', 'output.apng']]);
  expect(ffmpeg.deleted).toEqual(['000000.jpg', '000001.jpg', 'input.txt', 'output.apng']);
  expect(ffmpeg.terminated).toBe(true);
  expect(task.ffmpeg).toBeNull();
  expect(fired).toEqual(['start', 'complete']);
});

test.each(['apng', 'zip'])('keeps the %s blob url until its download finishes (#296)', async convertType => {
  vi.spyOn(URL, 'revokeObjectURL');
  const task = createTask({ convertType });

  task.start();
  await completeDownload(task);
  await vi.waitFor(() => expect(task.isComplete()).toBe(true));
  await browser._fake.flush();

  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  browser._fake.finishDownload(background.saves[0].downloadId, 'interrupted');
  await browser._fake.flush();
  expect(URL.revokeObjectURL.mock.calls).toEqual([[saved[0].url]]);
});

test('a zip task saves the frames zip, converts nothing and is done processing', async () => {
  const task = createTask({ id: '180', convertType: 'zip' });
  const fired = events(task);
  const progresses = [];
  task.addListener('progress', progress => progresses.push(progress));

  task.start();
  await completeDownload(task);
  await vi.waitFor(() => expect(task.isComplete()).toBe(true));

  expect(savedNames()).toEqual(['ugoira/180_Moving.zip']);
  expect(Object.keys((await RealJSZip.loadAsync(await saved[0].blob.arrayBuffer())).files))
    .toEqual(['000000.jpg', '000001.jpg']);
  expect(ffmpegs).toEqual([]);
  expect(fired).toEqual(['start', 'complete']);
  // processProgress 1 is what ticks the content script's button.
  expect(progresses.at(-1)).toBe(1);
  expect(task.toJson()).toMatchObject({ id: 'pixiv:180:apng', processProgress: 1, convertType: 'zip' });
});

test('a zip task after a conversion saves the cached zip without downloading it again', async () => {
  const first = createTask({ id: '181' });
  first.start();
  await completeDownload(first);
  await vi.waitFor(() => expect(first.isComplete()).toBe(true));

  const second = createTask({ id: '181', convertType: 'zip', packAnimationJsonType: 1 });
  await second.start();
  await vi.waitFor(() => expect(second.isComplete()).toBe(true));

  expect(background.requests).toHaveLength(1);
  expect(savedNames()).toEqual(['ugoira/181_Moving.apng', 'ugoira/181_Moving.zip']);
  const zip = await RealJSZip.loadAsync(await saved[1].blob.arrayBuffer());
  expect(Object.keys(zip.files)).toEqual(['000000.jpg', '000001.jpg', 'animation.json']);
});

test('a conversion after a zip task converts the cached zip without downloading it again', async () => {
  const first = createTask({ id: '182', convertType: 'zip' });
  first.start();
  await completeDownload(first);
  await vi.waitFor(() => expect(first.isComplete()).toBe(true));

  const second = createTask({ id: '182' });
  await second.start();
  await vi.waitFor(() => expect(second.isComplete()).toBe(true));

  expect(background.requests).toHaveLength(1);
  expect(ffmpegs).toHaveLength(1);
  expect(savedNames()).toEqual(['ugoira/182_Moving.zip', 'ugoira/182_Moving.apng']);
});

test.each([
  [1, '124', frames],
  [2, '134', {
    ugokuIllustData: {
      src: 'https://i.pximg.net/small.zip',
      originalSrc: resourceUrl('134'),
      mime_type: 'image/jpeg',
      frames
    }
  }]
])('animation json type %i is packed into the saved zip', async (type, id, json) => {
  const task = createTask({ id, packAnimationJsonType: type, convertType: 'zip' });

  task.start();
  await completeDownload(task);
  await vi.waitFor(() => expect(task.isComplete()).toBe(true));

  const zip = await RealJSZip.loadAsync(await saved[0].blob.arrayBuffer());
  expect(JSON.parse(await zip.file('animation.json').async('string'))).toEqual(json);
});

test.each(['apng', 'zip'])('a %s task saves the work information beside it when metadata is on', async convertType => {
  window.$app.settings.enableDownloadMetadata = true;
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const task = createTask({ id: convertType === 'apng' ? '125' : '135', convertType });
  const name = `ugoira/${task.options.context.id}_Moving.info.json`;

  task.start();
  await completeDownload(task);
  await vi.waitFor(() => expect(task.isComplete()).toBe(true));
  // #307: beside the saved file, not in the Downloads root.
  await vi.waitFor(() => expect(savedNames()).toContain(name));

  const info = saved.find(file => file.filename === name);
  expect(JSON.parse(await info.blob.text())).toMatchObject({ id: task.options.context.id, title: 'Moving' });
  const infoSave = background.saves.find(save => save.filename === name);
  await browser._fake.flush();
  expect(revoke).not.toHaveBeenCalledWith(infoSave.url);
  browser._fake.finishDownload(infoSave.downloadId);
  await browser._fake.flush();
  expect(revoke).toHaveBeenCalledWith(infoSave.url);
});

describe('frame timing (#322)', () => {
  test.each([
    ['equal delays', [100, 100, 150], 50],
    ['delays with no common step of 10ms or more', [33, 34, 33], 10],
    ['delays whose common step is not a multiple of 10ms', [15, 45, 30], 15],
    ['one frame', [70], 70],
    ['a frame with no usable delay', [0, 60, 90, undefined], 30]
  ])('tick: %s', (_, delays, tick) => {
    expect(UgoiraDownloadTask.tick(delays.map(delay => ({ delay })))).toBe(tick);
  });

  test('tick is undefined when no delay is a positive whole number of ms', () => {
    expect(UgoiraDownloadTask.tick([{ delay: 0 }, { delay: 12.5 }])).toBeUndefined();
  });

  test.each([
    ['adds -safe 0 before -i', '-f concat -i input.txt out.gif', '-f concat -safe 0 -i input.txt out.gif'],
    ['keeps a -safe the command already has', '-f concat -safe 0 -i input.txt out.gif', '-f concat -safe 0 -i input.txt out.gif'],
    ['adds one when the command has -safe only after -i, where it is an output option',
      '-f concat -i input.txt -safe 0 out.webm', '-f concat -safe 0 -i input.txt -safe 0 out.webm'],
    ['leaves a command that does not read input.txt', '-i step.mkv out.webm', '-i step.mkv out.webm'],
    ['leaves a command that reads input.txt without the concat demuxer', '-i input.txt out.gif', '-i input.txt out.gif'],
    ['adds one for input.txt under another path', '-f concat -i ./input.txt out.gif', '-f concat -safe 0 -i ./input.txt out.gif'],
    ['leaves a list that is only named like input.txt', '-f concat -i myinput.txt out.gif', '-f concat -i myinput.txt out.gif'],
    ['adds one for input.txt given with the file: protocol', '-f concat -i file:input.txt out.gif',
      '-f concat -safe 0 -i file:input.txt out.gif'],
    ['replaces a -safe value that is not 0', '-f concat -safe 1 -i input.txt out.gif', '-f concat -safe 0 -i input.txt out.gif'],
    ['replaces the -safe value of an input.txt that is not the first input', '-i a.mkv -f concat -safe 1 -i input.txt out.gif',
      '-i a.mkv -f concat -safe 0 -i input.txt out.gif'],
    ['adds one for each input that reads input.txt', '-f concat -i input.txt -f concat -i input.txt out.gif',
      '-f concat -safe 0 -i input.txt -f concat -safe 0 -i input.txt out.gif'],
    ['looks only at the options of the input that reads input.txt', '-safe 0 -i a.mkv -f concat -i input.txt out.gif',
      '-safe 0 -i a.mkv -f concat -safe 0 -i input.txt out.gif']
  ])('allowConcatOptions %s', (_, command, expected) => {
    const args = command.split(' ');

    UgoiraDownloadTask.allowConcatOptions(args);

    expect(args.join(' ')).toBe(expected);
  });

  test('frames without a usable delay leave input.txt as it was', async () => {
    const task = createTask({
      id: '170',
      frames: [{ file: '000000.jpg', delay: 0 }, { file: '000001.jpg', delay: 0 }]
    });

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(ffmpegs[0].files.get('input.txt'))
      .toBe("file '000000.jpg'\r\nduration 0\r\nfile '000001.jpg'\r\nduration 0\r\n");
  });

  test.each([
    ['gif', [20, 20, 20, 30]],
    ['apng', [20, 20, 20, 30]],
    ['video', [10, 19, 20, 30]]
  ])('timedFrames gives a %s these delays for 10, 19, 20 and 30ms', (format, delays) => {
    const frames = [10, 19, 20, 30].map(delay => ({ file: 'a.jpg', delay }));

    expect(UgoiraDownloadTask.timedFrames(frames, format).map(frame => frame.delay)).toEqual(delays);
    expect(frames.map(frame => frame.delay)).toEqual([10, 19, 20, 30]);
  });

  test.each([
    ['-i input.txt out.gif', 'gif'],
    ['-i input.txt dir/OUT.GIF', 'gif'],
    ['-i input.txt OUT.APNG', 'apng'],
    ['-i input.txt output.webm', 'video'],
    ['-i input.txt output.mp4', 'video'],
    ['-f concat -i input.txt out.gif', 'gif'],
    ['-i input.txt -f apng out.png', 'apng'],
    ['-i input.txt -f gif out.img', 'gif'],
    ['-i input.txt -f GIF out.gif', 'gif'],
    ['-i input.txt -f APNG out.png', 'apng'],
    ['-i input.txt -f webm out.gif', 'video']
  ])('outputFormat: %s is %s', (command, format) => {
    expect(UgoiraDownloadTask.outputFormat(command.split(' '))).toBe(format);
  });

  describe('the last frame keeps its delay (#325)', () => {
    const frames = [{ file: 'a.jpg', delay: 100 }, { file: 'b.jpg', delay: 100 }, { file: 'c.jpg', delay: 1000 }];
    const head = "file 'a.jpg'\r\noption framerate 1000/100\r\nduration 0.1\r\n" +
      "file 'b.jpg'\r\noption framerate 1000/100\r\nduration 0.1\r\n";
    const repeat = "file 'c.jpg'\r\noption framerate 1000/100\r\n";

    test.each([
      ['a video shortens it by the tick its repeat lasts', 'video', `${head}${repeat}duration 0.9\r\n${repeat}`],
      ['an APNG leaves it to -final_delay', 'apng', `${head}${repeat}duration 1\r\n`],
      ['a GIF leaves it to -final_delay', 'gif', `${head}${repeat}duration 1\r\n`]
    ])('concatList: %s', (_, format, list) => {
      expect(UgoiraDownloadTask.concatList(frames, format)).toBe(list);
    });

    test('concatList: a video whose last delay is under the 10ms tick is left as it is', () => {
      expect(UgoiraDownloadTask.concatList([{ file: 'a.jpg', delay: 100 }, { file: 'b.jpg', delay: 5 }], 'video')).toBe(
        "file 'a.jpg'\r\noption framerate 1000/10\r\nduration 0.1\r\n" +
        "file 'b.jpg'\r\noption framerate 1000/10\r\nduration 0.005\r\n"
      );
    });

    test('concatList: a frame with no delay gets no duration line', () => {
      expect(UgoiraDownloadTask.concatList([{ file: 'a.jpg', delay: 100 }, { file: 'b.jpg' }, { file: 'c.jpg', delay: 100 }]))
        .toBe(
          "file 'a.jpg'\r\noption framerate 1000/100\r\nduration 0.1\r\n" +
          "file 'b.jpg'\r\noption framerate 1000/100\r\n" +
          "file 'c.jpg'\r\noption framerate 1000/100\r\nduration 0.1\r\n"
        );
    });

    test('concatList: a video whose last frame lasts one tick is left as it is', () => {
      expect(UgoiraDownloadTask.concatList([{ file: 'a.jpg', delay: 70 }, { file: 'b.jpg', delay: 70 }], 'video')).toBe(
        "file 'a.jpg'\r\noption framerate 1000/70\r\nduration 0.07\r\n" +
        "file 'b.jpg'\r\noption framerate 1000/70\r\nduration 0.07\r\n"
      );
    });

    test('concatList: a video whose last delay is not usable repeats nothing', () => {
      expect(UgoiraDownloadTask.concatList([{ file: 'a.jpg', delay: 100 }, { file: 'b.jpg', delay: 0 }], 'video')).toBe(
        "file 'a.jpg'\r\noption framerate 1000/100\r\nduration 0.1\r\n" +
        "file 'b.jpg'\r\noption framerate 1000/100\r\nduration 0\r\n"
      );
    });

    test.each([
      ['a GIF gets the last delay in 10ms units before the output', 'gif', [100, 1000], '-plays 0 out.gif', '-plays 0 -final_delay 100 out.gif'],
      ['a GIF rounds it to the nearest 10ms', 'gif', [100, 1005], 'out.gif', '-final_delay 101 out.gif'],
      ['a GIF gives a last frame under 20ms 20ms', 'gif', [100, 10], 'out.gif', '-final_delay 2 out.gif'],
      ['a GIF caps it at the muxer\'s 65535', 'gif', [100, 700000], 'out.gif', '-final_delay 65535 out.gif'],
      ['an APNG gets the last delay in seconds', 'apng', [100, 1000], '-plays 0 out.apng', '-plays 0 -final_delay 1000/1000 out.apng'],
      ['an APNG keeps it to the ms', 'apng', [100, 1005], 'out.apng', '-final_delay 1005/1000 out.apng'],
      ['an APNG gives a last frame under 20ms 20ms', 'apng', [100, 10], 'out.apng', '-final_delay 20/1000 out.apng'],
      ['an APNG caps it at the muxer\'s 65535s', 'apng', [100, 70000000], 'out.apng', '-final_delay 65535000/1000 out.apng'],
      ['keeps a -final_delay the command sets', 'gif', [100, 1000], '-final_delay 5 out.gif', '-final_delay 5 out.gif'],
      ['leaves a last delay that is not usable', 'gif', [100, 0], 'out.gif', 'out.gif'],
      ['leaves an empty frame list', 'apng', [], 'out.apng', 'out.apng'],
      ['leaves a video', 'video', [100, 1000], 'out.webm', 'out.webm']
    ])('holdLastFrame: %s', (_, format, delays, command, expected) => {
      const args = command.split(' ');

      UgoiraDownloadTask.holdLastFrame(args, delays.map(delay => ({ delay })), format);

      expect(args.join(' ')).toBe(expected);
    });

    test('a two-line custom GIF command gets -final_delay on the line writing the GIF', async () => {
      const task = createTask({
        ffmpegCommandArgs: '-f concat -i input.txt -vf palettegen palette.png\n-f concat -i input.txt -i palette.png -lavfi paletteuse out.gif',
        convertType: 'CUSTOM'
      });

      task.start();
      await completeDownload(task);
      await vi.waitFor(() => expect(task.isComplete()).toBe(true));

      expect(ffmpegs[0].commands).toEqual([
        ['-f', 'concat', '-safe', '0', '-i', 'input.txt', '-vf', 'palettegen', 'palette.png'],
        ['-f', 'concat', '-safe', '0', '-i', 'input.txt', '-i', 'palette.png', '-lavfi', 'paletteuse', '-final_delay', '25', 'out.gif']
      ]);
    });

    test('a video command gets the shortened last frame and its repeat in input.txt', async () => {
      const task = createTask({ ffmpegCommandArgs: '-f concat -i input.txt output.mp4', convertType: 'CUSTOM' });

      task.start();
      await completeDownload(task);
      await vi.waitFor(() => expect(task.isComplete()).toBe(true));

      expect(ffmpegs[0].files.get('input.txt')).toBe(
        "file '000000.jpg'\r\noption framerate 1000/50\r\nduration 0.1\r\n" +
        "file '000001.jpg'\r\noption framerate 1000/50\r\nduration 0.2\r\n" +
        "file '000001.jpg'\r\noption framerate 1000/50\r\n"
      );
      expect(ffmpegs[0].commands).toEqual([['-f', 'concat', '-safe', '0', '-i', 'input.txt', 'output.mp4']]);
    });
  });

  test.each([
    ['a custom command whose output is a GIF', '-f concat -i input.txt -plays 0 fast.GIF', '1000/20', '0.02'],
    ['a custom command whose output is an APNG', '-f concat -i input.txt -plays 0 output.apng', '1000/20', '0.02'],
    ['a two-line custom command whose last output is a GIF',
      '-f concat -i input.txt -vf palettegen palette.png\n-f concat -i input.txt -i palette.png -lavfi paletteuse out.gif',
      '1000/20', '0.02'],
    ['a custom command whose output is a video', '-f concat -i input.txt output.webm', '1000/10', '0.01']
  ])('input.txt times a 10ms frame for %s', async (_, ffmpegCommandArgs, rate, duration) => {
    const task = createTask({
      ffmpegCommandArgs,
      convertType: 'CUSTOM',
      frames: [{ file: '000000.jpg', delay: 10 }, { file: '000001.jpg', delay: 10 }]
    });

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(ffmpegs[0].files.get('input.txt')).toBe(
      `file '000000.jpg'\r\noption framerate ${rate}\r\nduration ${duration}\r\n` +
      `file '000001.jpg'\r\noption framerate ${rate}\r\nduration ${duration}\r\n`
    );
  });
});

test('a custom command runs line by line, and its last output names the file', async () => {
  const task = createTask({
    id: '126',
    convertType: 'CUSTOM',
    ffmpegCommandArgs: ' -f concat -i input.txt step.mkv\n-i step.mkv output.webm \n'
  });

  task.start();
  await completeDownload(task);
  await vi.waitFor(() => expect(task.isComplete()).toBe(true));

  // Only the line reading input.txt needs -safe 0 for its `option` lines.
  expect(ffmpegs[0].commands).toEqual([
    ['-f', 'concat', '-safe', '0', '-i', 'input.txt', 'step.mkv'],
    ['-i', 'step.mkv', 'output.webm']
  ]);
  expect(savedNames()).toEqual(['ugoira/126_Moving.webm']);
  expect(saved[0].blob.type).toBe('video/webm');
});

test('reports conversion progress, and toJson carries it with the convert type', async () => {
  const task = createTask({ id: '127' });
  const progresses = [];
  task.addListener('progress', progress => progresses.push(progress));

  task.start();
  await completeDownload(task);
  await vi.waitFor(() => expect(task.isComplete()).toBe(true));

  expect(progresses).toContain(0.5);
  expect(task.toJson()).toMatchObject({
    type: 'PIXIV_UGOIRA',
    id: 'pixiv:127:apng',
    state: task.COMPLETE_STATE,
    progress: 1,
    processProgress: 0.5,
    convertType: 'apng'
  });
});

test('a conversion that fails fails the task and saves nothing', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const task = createTask({ id: '128' });
  const fired = events(task);
  const error = new Error('ffmpeg exited');
  FakeFFmpeg.execGate = Promise.reject(error);
  FakeFFmpeg.execGate.catch(() => {});

  task.start();
  await completeDownload(task);
  await vi.waitFor(() => expect(task.isFailure()).toBe(true));

  expect(task.lastError).toBe(error);
  expect(task.toJson()).toMatchObject({ error: 'ffmpeg exited', convertType: expect.anything() });
  expect(fired).toEqual(['start', 'failure']);
  expect(ffmpegs[0].terminated).toBe(true);
  expect(saved).toEqual([]);
  expect(console.error).toHaveBeenCalledWith('Could not convert ugoira pixiv:128:apng', error);
});

test('a download that fails fails the task before any conversion', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const task = createTask({ id: '129' });

  task.start();
  await vi.waitFor(() => expect(background.request(task.options.resource)).toBeDefined());
  background.request(task.options.resource).fail('HTTP 403');
  await vi.waitFor(() => expect(task.isFailure()).toBe(true));

  expect(task.lastError).toEqual(new Error('HTTP 403'));
  expect(ffmpegs).toEqual([]);
  expect(saved).toEqual([]);
});

test('a second task for the same work converts the cached zip without downloading it again', async () => {
  const first = createTask({ id: '130' });
  first.start();
  await completeDownload(first);
  await vi.waitFor(() => expect(first.isComplete()).toBe(true));

  const second = createTask({ id: '130', convertType: 'CUSTOM', ffmpegCommandArgs: '-f concat -i input.txt output.apng' });
  await second.start();
  await vi.waitFor(() => expect(second.isComplete()).toBe(true));

  expect(background.requests).toHaveLength(1);
  expect(second.progress).toBe(1);
  expect(ffmpegs[1].commands)
    .toEqual([['-f', 'concat', '-safe', '0', '-i', 'input.txt', '-final_delay', '250/1000', 'output.apng']]);
  expect(savedNames()).toEqual(['ugoira/130_Moving.apng', 'ugoira/130_Moving.apng']);
});

test('a second start() while the cached zip loads converts it once', async () => {
  const first = createTask({ id: '133' });
  first.start();
  await completeDownload(first);
  await vi.waitFor(() => expect(first.isComplete()).toBe(true));

  const second = createTask({ id: '133' });
  const fired = events(second);
  second.start();
  second.start();
  await vi.waitFor(() => expect(second.isComplete()).toBe(true));
  await new Promise(resolve => setTimeout(resolve, 20));

  expect(fired).toEqual(['start', 'complete']);
  expect(ffmpegs).toHaveLength(2);
  expect(savedNames()).toEqual(['ugoira/133_Moving.apng', 'ugoira/133_Moving.apng']);
});

// #311: the task used to stay downloading for good, as the rejection went unhandled.
describe('a cached zip that will not load', () => {
  const notAZip = new Blob(['not a zip']);
  const cacheGarbage = id => ZipRepo.getDefault().storeZip(`pixiv:${id}`, notAZip);

  test('is dropped, and the work is downloaded and converted instead', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    cacheGarbage('160');
    const task = createTask({ id: '160' });

    await task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(background.requests).toHaveLength(1);
    expect(savedNames()).toEqual(['ugoira/160_Moving.apng']);
    // The download replaced the bad entry, so the next conversion uses it.
    expect(ZipRepo.getDefault().getZip('pixiv:160')).toBeDefined();
    expect(ZipRepo.getDefault().getZip('pixiv:160')).not.toBe(notAZip);
    expect(console.error).toHaveBeenCalledWith('Could not load the cached zip of pixiv:160', expect.any(Error));
  });

  test('downloads nothing if the task was paused while it loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    cacheGarbage('161');
    const task = createTask({ id: '161' });

    const starting = task.start();
    task.pause();
    await starting;
    await browser._fake.flush();

    expect(task.isPaused()).toBe(true);
    expect(background.requests).toEqual([]);
    expect(ZipRepo.getDefault().getZip('pixiv:161')).toBeUndefined();
  });
});

test('retrying a ugoira whose conversion failed, through the download manager, converts the cached zip once', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  DownloadManager.defaultInstance = undefined;
  const manager = DownloadManager.getDefault();
  const task = createTask({ id: '140' });
  FakeFFmpeg.execGate = Promise.reject(new Error('ffmpeg exited'));
  FakeFFmpeg.execGate.catch(() => {});
  await manager.addTask(task);
  await completeDownload(task);
  await vi.waitFor(() => expect(task.isFailure()).toBe(true));

  await manager.startTask(task.id);
  // Another task finishing restarts the queue while the cached zip loads.
  manager.startTasks();
  await vi.waitFor(() => expect(task.isComplete()).toBe(true));
  await new Promise(resolve => setTimeout(resolve, 20));

  expect(background.requests).toHaveLength(1);
  expect(ffmpegs).toHaveLength(2);
  expect(savedNames()).toEqual(['ugoira/140_Moving.apng']);
  expect(manager.lastError).toBeNull();
});

test('pause aborts the download, and a restarted task fetches the zip again and finishes', async () => {
  const task = createTask({ id: '131' });
  const fired = events(task);

  task.start();
  await vi.waitFor(() => expect(background.request(task.options.resource)).toBeDefined());
  task.pause();
  await vi.waitFor(() => expect(fired).toContain('pause'));

  expect(task.isPaused()).toBe(true);
  expect(background.aborted).toEqual([resourceUrl('131')]);

  task.tryPending();
  task.start(false);
  await vi.waitFor(() => expect(background.requests).toHaveLength(2));
  await completeDownload(task);
  await vi.waitFor(() => expect(task.isComplete()).toBe(true));

  expect(savedNames()).toEqual(['ugoira/131_Moving.apng']);
});

test('pause leaves a conversion running; stop terminates it', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const task = createTask({ id: '132' });
  FakeFFmpeg.execGate = new Promise(() => {});

  task.start();
  await completeDownload(task);
  await vi.waitFor(() => expect(ffmpegs[0]?.commands).toHaveLength(1));

  task.pause();
  expect(task.state).toBe(task.PROCESSING_STATE);
  expect(ffmpegs[0].terminated).toBe(false);

  task.stop();
  expect(ffmpegs[0].terminated).toBe(true);
  expect(task.processProgress).toBe(0);
  await vi.waitFor(() => expect(task.isFailure()).toBe(true));
  expect(task.lastError).toEqual(new Error('called FFmpeg.terminate()'));
});

test('start does nothing unless the task is pending', async () => {
  const task = createTask();
  task.changeState(task.COMPLETE_STATE);

  await task.start();
  await browser._fake.flush();

  expect(background.requests).toEqual([]);
});

describe('a save that fails fails the task', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('the frames zip: a retry saves the cached zip again without downloading it', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    let failing = true;
    background.failSaves(save => failing && save.filename.endsWith('.zip'));
    const task = createTask({ id: '150', convertType: 'zip' });

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isFailure()).toBe(true));

    expect(task.lastError).toEqual(new Error('Could not save "ugoira/150_Moving.zip"'));
    expect(console.error).toHaveBeenCalledWith('Could not save the frames zip of ugoira pixiv:150:apng', task.lastError);
    expect(revoke).toHaveBeenCalledWith(background.saves[0].url);

    failing = false;
    task.changeState(task.PENDING_STATE);
    await task.start();
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(background.requests).toHaveLength(1);
    expect(savedNames()).toEqual(['ugoira/150_Moving.zip', 'ugoira/150_Moving.zip']);
  });

  test('info.json: nothing is converted, and a retry downloads again', async () => {
    window.$app.settings.enableDownloadMetadata = true;
    let failing = true;
    background.failSaves(save => failing && save.filename === 'ugoira/151_Moving.info.json');
    const task = createTask({ id: '151' });

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isFailure()).toBe(true));

    expect(task.lastError).toEqual(new Error('Could not save "ugoira/151_Moving.info.json"'));
    expect(ffmpegs).toEqual([]);

    failing = false;
    task.changeState(task.PENDING_STATE);
    task.start();
    await vi.waitFor(() => expect(background.requests).toHaveLength(2));
    background.requests[1].complete(await framesZip(), 'application/zip');
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(savedNames()).toEqual([
      'ugoira/151_Moving.info.json', 'ugoira/151_Moving.info.json', 'ugoira/151_Moving.apng'
    ]);
  });

  test('the converted animation', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    background.failSaves(save => save.filename.endsWith('.apng'));
    const task = createTask({ id: '152' });

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isFailure()).toBe(true));

    expect(task.lastError).toEqual(new Error('Could not save "ugoira/152_Moving.apng"'));
    expect(ffmpegs[0].terminated).toBe(true);
    expect(revoke).toHaveBeenCalledWith(background.saves.find(save => save.filename.endsWith('.apng')).url);
  });
});

describe('WEBM through WebCodecs', () => {
  const webmTask = id => createTask({ id, taskId: `pixiv:${id}:webm`, convertType: 'webm', ffmpegCommandArgs: '' });

  beforeEach(() => {
    encodeVideo.mockReset();
    encodeVideo.mockResolvedValue({ data: new Uint8Array([4, 5, 6]), mimeType: 'video/webm', extension: 'webm', codec: 'vp9' });
  });

  test('encodes each frame with its delay, without FFmpeg, and saves the video', async () => {
    const task = webmTask('190');

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(savedNames()).toEqual(['ugoira/190_Moving.webm']);
    expect(saved[0].blob.type).toBe('video/webm');
    expect(new Uint8Array(await saved[0].blob.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6]));
    expect(ffmpegs).toEqual([]);

    const [{ frames: encoded, container, signal }] = encodeVideo.mock.calls[0];
    expect(container).toBe('webm');
    expect(signal.aborted).toBe(false);
    expect(encoded.map(frame => frame.delay)).toEqual([100, 250]);
    expect(encoded.map(frame => frame.image.type)).toEqual(['image/jpeg', 'image/jpeg']);
    expect(await Promise.all(encoded.map(frame => frame.image.text()))).toEqual(['frame 0', 'frame 1']);
  });

  test('encodes MP4 through the same encoder', async () => {
    encodeVideo.mockResolvedValue({ data: new Uint8Array([7]), mimeType: 'video/mp4', extension: 'mp4', codec: 'avc' });
    const task = createTask({ id: '194', taskId: 'pixiv:194:mp4', convertType: 'mp4', ffmpegCommandArgs: '' });

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(savedNames()).toEqual(['ugoira/194_Moving.mp4']);
    expect(saved[0].blob.type).toBe('video/mp4');
    expect(ffmpegs).toEqual([]);
    expect(encodeVideo.mock.calls[0][0].container).toBe('mp4');
  });

  test.each([['195', 'vp8'], ['196', undefined]])('task %s hands the encoder its codec, %s', async (id, codec) => {
    const task = createTask({ id, taskId: `pixiv:${id}:webm`, convertType: 'webm', ffmpegCommandArgs: '', codec });

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(encodeVideo.mock.calls[0][0]).toMatchObject({ container: 'webm', codec });
  });

  test.each([
    ['197', true, 'vp9'],
    ['198', false, null]
  ])('task %s carries the codec in toJson when the fallback chose it (%s), from the first progress on', async (id, fallback, shown) => {
    const task = webmTask(id);
    const atProgress = [];
    task.addListener('progress', progress => atProgress.push([progress, task.toJson().fallbackCodec]));
    encodeVideo.mockImplementation(async ({ onCodec, onProgress }) => {
      onCodec({ codec: 'vp9', fallback });
      onProgress(0.5);
      return { data: new Uint8Array([1]), mimeType: 'video/webm', extension: 'webm', codec: 'vp9' };
    });
    expect(task.toJson().fallbackCodec).toBeNull();

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    // A progress event marks the task changed, and the download manager's poll then reads toJson.
    expect(atProgress.find(([progress]) => progress === 0.5)).toEqual([0.5, shown]);
    expect(task.toJson().fallbackCodec).toBe(shown);
  });

  test("a retry that fails before choosing a codec drops the last attempt's", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const task = webmTask('199');
    encodeVideo.mockImplementationOnce(async ({ onCodec }) => {
      onCodec({ codec: 'vp8', fallback: true });
      throw new Error('encoder crashed');
    });
    encodeVideo.mockImplementationOnce(async () => {
      throw new Error("This browser can't encode WEBM video at 16x16");
    });

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isFailure()).toBe(true));
    expect(task.toJson().fallbackCodec).toBe('vp8');

    task.changeState(task.PENDING_STATE);
    await task.start();
    await vi.waitFor(() => expect(encodeVideo).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(task.isFailure()).toBe(true));

    expect(task.toJson().fallbackCodec).toBeNull();
  });

  test('reports the encoding progress', async () => {
    const task = webmTask('191');
    const progresses = [];
    task.addListener('progress', progress => progresses.push(progress));
    encodeVideo.mockImplementation(async ({ onProgress }) => {
      onProgress(0.5);
      onProgress(1);
      return { data: new Uint8Array([1]), mimeType: 'video/webm', extension: 'webm', codec: 'vp9' };
    });

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(progresses).toEqual(expect.arrayContaining([0.5, 1]));
    expect(task.toJson()).toMatchObject({ processProgress: 1, convertType: 'webm' });
  });

  test('an encoding that fails fails the task and saves nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const task = webmTask('192');
    const error = new Error("This browser can't encode WEBM video at 16x16");
    encodeVideo.mockRejectedValue(error);

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isFailure()).toBe(true));

    expect(task.lastError).toBe(error);
    expect(savedNames()).toEqual([]);
    expect(console.error).toHaveBeenCalledWith('Could not convert ugoira pixiv:192:webm', error);
  });

  test('stop aborts the encoding', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const task = webmTask('193');
    let encodeSignal;
    encodeVideo.mockImplementation(({ signal }) => new Promise((resolve, reject) => {
      encodeSignal = signal;
      signal.addEventListener('abort', () => reject(signal.reason));
    }));

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(encodeSignal).toBeDefined());

    task.pause();
    expect(encodeSignal.aborted).toBe(false);

    task.stop();
    expect(encodeSignal.aborted).toBe(true);
    await vi.waitFor(() => expect(task.isFailure()).toBe(true));
    expect(task.processProgress).toBe(0);
    expect(task.encodeController).toBeNull();
  });
});

describe('GIF in the browser', () => {
  const gifTask = id => createTask({ id, taskId: `pixiv:${id}:gif`, convertType: 'gif', ffmpegCommandArgs: '' });

  beforeEach(() => {
    encodeGif.mockReset();
    encodeGif.mockResolvedValue({ data: new Uint8Array([7, 8, 9]), mimeType: 'image/gif', extension: 'gif' });
  });

  test('encodes each frame with its delay, without FFmpeg, and saves the GIF', async () => {
    const task = gifTask('200');
    const fired = events(task);

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(savedNames()).toEqual(['ugoira/200_Moving.gif']);
    expect(saved[0].blob.type).toBe('image/gif');
    expect(new Uint8Array(await saved[0].blob.arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]));
    expect(ffmpegs).toEqual([]);
    expect(encodeVideo).not.toHaveBeenCalled();
    expect(fired).toEqual(['start', 'complete']);

    const [{ frames: encoded, signal }] = encodeGif.mock.calls[0];
    expect(signal.aborted).toBe(false);
    expect(encoded.map(frame => frame.delay)).toEqual([100, 250]);
    expect(encoded.map(frame => frame.image.type)).toEqual(['image/jpeg', 'image/jpeg']);
    expect(await Promise.all(encoded.map(frame => frame.image.text()))).toEqual(['frame 0', 'frame 1']);
  });

  test('reports the encoding progress', async () => {
    const task = gifTask('201');
    const progresses = [];
    task.addListener('progress', progress => progresses.push(progress));
    encodeGif.mockImplementation(async ({ onProgress }) => {
      onProgress(0.5);
      onProgress(1);
      return { data: new Uint8Array([1]), mimeType: 'image/gif', extension: 'gif' };
    });

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(progresses).toEqual(expect.arrayContaining([0.5, 1]));
    expect(task.toJson()).toMatchObject({ processProgress: 1, convertType: 'gif', fallbackCodec: null });
  });

  test('an encoding that fails fails the task and saves nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const task = gifTask('202');
    const error = new Error('Could not encode GIF frame 2: decode failed');
    encodeGif.mockRejectedValue(error);

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isFailure()).toBe(true));

    expect(task.lastError).toBe(error);
    expect(savedNames()).toEqual([]);
    expect(console.error).toHaveBeenCalledWith('Could not convert ugoira pixiv:202:gif', error);
  });

  test('stop aborts the encoding', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const task = gifTask('203');
    let encodeSignal;
    encodeGif.mockImplementation(({ signal }) => new Promise((resolve, reject) => {
      encodeSignal = signal;
      signal.addEventListener('abort', () => reject(signal.reason));
    }));

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(encodeSignal).toBeDefined());

    task.stop();
    expect(encodeSignal.aborted).toBe(true);
    await vi.waitFor(() => expect(task.isFailure()).toBe(true));
    expect(task.processProgress).toBe(0);
    expect(task.encodeController).toBeNull();
  });
});
