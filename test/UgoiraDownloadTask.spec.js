/**
 * UgoiraDownloadTask driving a real Downloader and the real JSZip the download
 * manager page loads. The background's end of the `DownloadFile` port is the
 * network stand-in, and the encoders are fakes that record what they are asked to do;
 * e2e/ugoira.e2e.js runs the real conversion.
 */
import RealJSZip from 'jszip/dist/jszip.min.js';
import browser from './doubles/browser';
import { fakeDownloadFileBackground } from './helpers/downloadFileBackground';
import UgoiraDownloadTask, { ZipRepo } from '@/options_page/modules/DownloadTasks/Pixiv/UgoiraDownloadTask';
import DownloadManager from '@/options_page/modules/DownloadManager';
import { encodeVideo } from '@/options_page/modules/UgoiraEncoders/video';
import { encodeGif } from '@/options_page/modules/UgoiraEncoders/gif';
import { encodeApng } from '@/options_page/modules/UgoiraEncoders/apng';

// Node has no WebCodecs; test/ugoiraVideoEncoder.spec.js and the e2e tests cover the encoder.
vi.mock('@/options_page/modules/UgoiraEncoders/video', async importOriginal => ({
  ...await importOriginal(),
  encodeVideo: vi.fn()
}));
// Node has no Worker or OffscreenCanvas; test/ugoiraGifEncoder.spec.js, test/ugoiraApngEncoder.spec.js
// and the e2e tests cover the encoders.
vi.mock('@/options_page/modules/UgoiraEncoders/gif', async importOriginal => ({
  ...await importOriginal(),
  encodeGif: vi.fn()
}));
vi.mock('@/options_page/modules/UgoiraEncoders/apng', async importOriginal => ({
  ...await importOriginal(),
  encodeApng: vi.fn()
}));

const resourceUrl = id => `https://i.pximg.net/img-zip-ugoira/img/${id}_ugoira1920x1080.zip`;
const frames = [{ file: '000000.jpg', delay: 100 }, { file: '000001.jpg', delay: 250 }];
// The tasks encode an APNG unless a test says otherwise.
const APNG = { data: new Uint8Array([1, 2, 3]), mimeType: 'image/apng', extension: 'apng' };

let background;
let saved;
let nextId = 1000;

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
  // Module mocks keep their calls across tests; vi.restoreAllMocks() restores only spies.
  for (const encode of [encodeVideo, encodeGif, encodeApng]) {
    encode.mockReset();
  }
  encodeApng.mockResolvedValue(APNG);
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
  expect(encodeApng).toHaveBeenCalledTimes(1);
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
  expect(encodeApng).not.toHaveBeenCalled();
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
  expect(encodeApng).toHaveBeenCalledTimes(1);
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

test('reports conversion progress, and toJson carries it with the convert type', async () => {
  const task = createTask({ id: '127' });
  const progresses = [];
  task.addListener('progress', progress => progresses.push(progress));
  encodeApng.mockImplementation(async ({ onProgress }) => {
    onProgress(0.5);
    return APNG;
  });

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
  const error = new Error('Could not encode APNG frame 1: decode failed');
  encodeApng.mockRejectedValue(error);

  task.start();
  await completeDownload(task);
  await vi.waitFor(() => expect(task.isFailure()).toBe(true));

  expect(task.lastError).toBe(error);
  expect(task.toJson()).toMatchObject({ error: error.message, convertType: 'apng' });
  expect(fired).toEqual(['start', 'failure']);
  expect(saved).toEqual([]);
  expect(console.error).toHaveBeenCalledWith('Could not convert ugoira pixiv:128:apng', error);
});

test('a frame missing from the zip fails the task, naming the frame, and saves nothing', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const task = createTask({ frames: [...frames, { file: '000002.jpg', delay: 100 }] });

  task.start();
  await completeDownload(task);
  await vi.waitFor(() => expect(task.isFailure()).toBe(true));

  // Not "Cannot read properties of null (reading 'async')" (#454).
  expect(task.toJson().error).toBe('The ugoira zip has no frame 000002.jpg');
  expect(encodeApng).not.toHaveBeenCalled();
  expect(saved).toEqual([]);
});

// IllustAdapter refuses these first; the task fails rather than save something it can't name.
test.each(['custom', undefined])('a task of unknown convert type %s fails and saves nothing', async convertType => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const task = createTask({ convertType });

  task.start();
  await completeDownload(task);
  await vi.waitFor(() => expect(task.isFailure()).toBe(true));

  expect(task.lastError).toEqual(new Error(`Unknown ugoira convert type: ${convertType}`));
  expect(encodeApng).not.toHaveBeenCalled();
  expect(encodeGif).not.toHaveBeenCalled();
  expect(encodeVideo).not.toHaveBeenCalled();
  expect(saved).toEqual([]);
});

test('a download that fails fails the task before any conversion', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const task = createTask({ id: '129' });

  task.start();
  await vi.waitFor(() => expect(background.request(task.options.resource)).toBeDefined());
  background.request(task.options.resource).fail('HTTP 403');
  await vi.waitFor(() => expect(task.isFailure()).toBe(true));

  expect(task.lastError).toEqual(new Error('HTTP 403'));
  expect(encodeApng).not.toHaveBeenCalled();
  expect(saved).toEqual([]);
});

test('a second task for the same work converts the cached zip without downloading it again', async () => {
  const first = createTask({ id: '130' });
  first.start();
  await completeDownload(first);
  await vi.waitFor(() => expect(first.isComplete()).toBe(true));

  encodeGif.mockResolvedValue({ data: new Uint8Array([7]), mimeType: 'image/gif', extension: 'gif' });
  const second = createTask({ id: '130', taskId: 'pixiv:130:gif', convertType: 'gif' });
  await second.start();
  await vi.waitFor(() => expect(second.isComplete()).toBe(true));

  expect(background.requests).toHaveLength(1);
  expect(second.progress).toBe(1);
  expect(await Promise.all(encodeGif.mock.calls[0][0].frames.map(frame => frame.image.text()))).toEqual(['frame 0', 'frame 1']);
  expect(savedNames()).toEqual(['ugoira/130_Moving.apng', 'ugoira/130_Moving.gif']);
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
  expect(encodeApng).toHaveBeenCalledTimes(2);
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
  encodeApng.mockRejectedValueOnce(new Error('Could not encode APNG frame 1: decode failed'));
  await manager.addTask(task);
  await completeDownload(task);
  await vi.waitFor(() => expect(task.isFailure()).toBe(true));

  await manager.startTask(task.id);
  // Another task finishing restarts the queue while the cached zip loads.
  manager.startTasks();
  await vi.waitFor(() => expect(task.isComplete()).toBe(true));
  await new Promise(resolve => setTimeout(resolve, 20));

  expect(background.requests).toHaveLength(1);
  expect(encodeApng).toHaveBeenCalledTimes(2);
  expect(savedNames()).toEqual(['ugoira/140_Moving.apng']);
  expect(manager.lastError).toBeNull();
});

/** Completes a first task for the work, so the next one's frames zip comes from the cache. */
const cacheZip = async id => {
  const first = createTask({ id });
  first.start();
  await completeDownload(first);
  await vi.waitFor(() => expect(first.isComplete()).toBe(true));
  encodeApng.mockClear();
  saved.length = 0;
};

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

// #438
describe('a task stopped while its cached zip loads', () => {
  test('converts nothing once paused', async () => {
    await cacheZip('170');
    const task = createTask({ id: '170' });
    const fired = events(task);

    const starting = task.start();
    task.pause();
    await starting;
    await settle();

    expect(task.isPaused()).toBe(true);
    expect(fired).toEqual(['start']);
    expect(encodeApng).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  test('converts once when paused and started again before the zip loaded', async () => {
    await cacheZip('171');
    const task = createTask({ id: '171' });

    const starting = task.start();
    task.pause();
    task.tryPending();
    task.start();
    await starting;
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));
    await settle();

    expect(encodeApng).toHaveBeenCalledTimes(1);
    expect(savedNames()).toEqual(['ugoira/171_Moving.apng']);
  });

  test('converts nothing once deleted through the download manager', async () => {
    await cacheZip('172');
    DownloadManager.defaultInstance = undefined;
    const manager = DownloadManager.getDefault();
    const task = createTask({ id: '172' });
    const fired = events(task);

    await manager.addTask(task);
    await manager.deleteTask(task.id);
    await settle();

    expect(fired).toEqual(['start']);
    expect(encodeApng).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });
});

// #453
describe('a task deleted through the download manager while it converts', () => {
  let manager;

  beforeEach(() => {
    DownloadManager.defaultInstance = undefined;
    manager = DownloadManager.getDefault();
  });

  test('ends quietly when deleted during the encoding', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const task = createTask({ id: '173', taskId: 'pixiv:173:gif', convertType: 'gif' });
    const fired = events(task);
    const updates = [];
    manager.addListener('update', ids => updates.push(...ids));
    let encodeSignal;
    encodeGif.mockImplementation(({ signal }) => new Promise((resolve, reject) => {
      encodeSignal = signal;
      signal.addEventListener('abort', () => reject(signal.reason));
    }));

    await manager.addTask(task);
    await completeDownload(task);
    await vi.waitFor(() => expect(encodeSignal).toBeDefined());
    updates.length = 0;

    await manager.deleteTask(task.id);
    await settle();

    expect(encodeSignal.aborted).toBe(true);
    expect(fired).toEqual(['start']);
    expect(task.lastError).toBeUndefined();
    expect(task.isFailure()).toBe(false);
    expect(updates).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  test('saves nothing when deleted as the encoding finishes', async () => {
    const task = createTask({ id: '174' });
    const fired = events(task);
    encodeApng.mockImplementation(async () => {
      await manager.deleteTask(task.id);
      return APNG;
    });

    await manager.addTask(task);
    await completeDownload(task);
    await vi.waitFor(() => expect(encodeApng).toHaveBeenCalled());
    await settle();

    expect(fired).toEqual(['start']);
    expect(task.lastError).toBeUndefined();
    expect(saved).toEqual([]);
  });

  test('neither completes nor fails when deleted while its file saves', async () => {
    const task = createTask({ id: '175' });
    const fired = events(task);
    browser.runtime.onMessage.addListener(message => {
      if (message.action === 'download:saveFile' && manager.tasks.has(task.id)) {
        manager.deleteTask(task.id);
      }
    });

    await manager.addTask(task);
    await completeDownload(task);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    await settle();

    expect(fired).toEqual(['start']);
    expect(task.isComplete()).toBe(false);
    expect(task.lastError).toBeUndefined();
  });

  test('a zip task saves nothing when deleted while the zip is generated', async () => {
    await cacheZip('176');
    const task = createTask({ id: '176', taskId: 'pixiv:176:zip', convertType: 'zip' });
    const fired = events(task);
    const generateAsync = RealJSZip.prototype.generateAsync;
    vi.spyOn(RealJSZip.prototype, 'generateAsync').mockImplementation(function (...args) {
      manager.deleteTask(task.id);
      return generateAsync.apply(this, args);
    });

    await manager.addTask(task);
    await settle();

    expect(fired).toEqual(['start']);
    expect(task.lastError).toBeUndefined();
    expect(saved).toEqual([]);
  });

  // #468
  test('saves no info.json and caches no zip when deleted as its frames zip arrives', async () => {
    window.$app.settings.enableDownloadMetadata = true;
    const consoleError = vi.spyOn(console, 'error');
    const task = createTask({ id: '178' });
    const fired = events(task);
    const loadAsync = RealJSZip.prototype.loadAsync;
    vi.spyOn(RealJSZip.prototype, 'loadAsync').mockImplementation(function (...args) {
      manager.deleteTask(task.id);
      return loadAsync.apply(this, args);
    });

    await manager.addTask(task);
    await completeDownload(task);
    await vi.waitFor(() => expect(RealJSZip.prototype.loadAsync).toHaveBeenCalled());
    await settle();

    expect(fired).not.toContain('complete');
    expect(fired).not.toContain('failure');
    expect(task.lastError).toBeUndefined();
    expect(consoleError).not.toHaveBeenCalled();
    expect(encodeApng).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(ZipRepo.getDefault().getZip('pixiv:178')).toBeUndefined();
  });
});

test('a failed conversion drops its progress, and a retry starts from 0', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const task = createTask({ id: '177', taskId: 'pixiv:177:gif', convertType: 'gif' });
  encodeGif.mockImplementationOnce(async ({ onProgress }) => {
    onProgress(0.6);
    throw new Error('Could not encode GIF frame 2: decode failed');
  });

  task.start();
  await completeDownload(task);
  await vi.waitFor(() => expect(task.isFailure()).toBe(true));
  expect(task.processProgress).toBe(0);

  let progressAtStart;
  encodeGif.mockImplementationOnce(async () => {
    progressAtStart = task.processProgress;
    return { data: new Uint8Array([1]), mimeType: 'image/gif', extension: 'gif' };
  });
  task.tryPending();
  await task.start();
  await vi.waitFor(() => expect(task.isComplete()).toBe(true));

  expect(progressAtStart).toBe(0);
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
    expect(encodeApng).not.toHaveBeenCalled();

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
    encodeApng.mockImplementation(async ({ onProgress }) => {
      onProgress(1);
      return APNG;
    });
    const task = createTask({ id: '152' });

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isFailure()).toBe(true));

    expect(task.lastError).toEqual(new Error('Could not save "ugoira/152_Moving.apng"'));
    // The encoder's 100% is not done: the content script would tick the failed task's button.
    expect(task.processProgress).toBe(0);
    expect(revoke).toHaveBeenCalledWith(background.saves.find(save => save.filename.endsWith('.apng')).url);
  });
});

describe('WEBM through WebCodecs', () => {
  const webmTask = id => createTask({ id, taskId: `pixiv:${id}:webm`, convertType: 'webm' });

  beforeEach(() => {
    encodeVideo.mockResolvedValue({ data: new Uint8Array([4, 5, 6]), mimeType: 'video/webm', extension: 'webm', codec: 'vp9' });
  });

  test('encodes each frame with its delay and saves the video', async () => {
    const task = webmTask('190');

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(savedNames()).toEqual(['ugoira/190_Moving.webm']);
    expect(saved[0].blob.type).toBe('video/webm');
    expect(new Uint8Array(await saved[0].blob.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6]));

    const [{ frames: encoded, container, signal }] = encodeVideo.mock.calls[0];
    expect(container).toBe('webm');
    expect(signal.aborted).toBe(false);
    expect(encoded.map(frame => frame.delay)).toEqual([100, 250]);
    expect(encoded.map(frame => frame.image.type)).toEqual(['image/jpeg', 'image/jpeg']);
    expect(await Promise.all(encoded.map(frame => frame.image.text()))).toEqual(['frame 0', 'frame 1']);
  });

  test('encodes MP4 through the same encoder', async () => {
    encodeVideo.mockResolvedValue({ data: new Uint8Array([7]), mimeType: 'video/mp4', extension: 'mp4', codec: 'avc' });
    const task = createTask({ id: '194', taskId: 'pixiv:194:mp4', convertType: 'mp4' });

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(savedNames()).toEqual(['ugoira/194_Moving.mp4']);
    expect(saved[0].blob.type).toBe('video/mp4');
    expect(encodeVideo.mock.calls[0][0].container).toBe('mp4');
  });

  test.each([['195', 'vp8'], ['196', undefined]])('task %s hands the encoder its codec, %s', async (id, codec) => {
    const task = createTask({ id, taskId: `pixiv:${id}:webm`, convertType: 'webm', codec });

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

  test('pause leaves an encoding running; stop aborts it, and a retry gets a fresh signal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const task = webmTask('193');
    let encodeSignal;
    encodeVideo.mockImplementationOnce(({ signal, onProgress }) => new Promise((resolve, reject) => {
      encodeSignal = signal;
      onProgress(1);
      signal.addEventListener('abort', () => reject(signal.reason));
    }));

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(encodeSignal).toBeDefined());

    task.pause();
    expect(encodeSignal.aborted).toBe(false);
    expect(task.state).toBe(task.PROCESSING_STATE);
    // Progress 1 is what marks the content script's button done, so stop must clear it.
    expect(task.processProgress).toBe(1);

    task.stop();
    expect(encodeSignal.aborted).toBe(true);
    await vi.waitFor(() => expect(task.isFailure()).toBe(true));
    expect(task.lastError.name).toBe('AbortError');
    expect(task.processProgress).toBe(0);
    expect(task.encodeController).toBeNull();

    task.changeState(task.PENDING_STATE);
    await task.start();
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));
    expect(encodeVideo.mock.calls[1][0].signal.aborted).toBe(false);
  });
});

describe('GIF in the browser', () => {
  const gifTask = id => createTask({ id, taskId: `pixiv:${id}:gif`, convertType: 'gif' });

  beforeEach(() => {
    encodeGif.mockResolvedValue({ data: new Uint8Array([7, 8, 9]), mimeType: 'image/gif', extension: 'gif' });
  });

  test('encodes each frame with its delay and saves the GIF', async () => {
    const task = gifTask('200');
    const fired = events(task);

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(savedNames()).toEqual(['ugoira/200_Moving.gif']);
    expect(saved[0].blob.type).toBe('image/gif');
    expect(new Uint8Array(await saved[0].blob.arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]));
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
    encodeGif.mockImplementation(({ signal, onProgress }) => new Promise((resolve, reject) => {
      encodeSignal = signal;
      onProgress(1);
      signal.addEventListener('abort', () => reject(signal.reason));
    }));

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(encodeSignal).toBeDefined());
    expect(task.processProgress).toBe(1);

    task.stop();
    expect(encodeSignal.aborted).toBe(true);
    await vi.waitFor(() => expect(task.isFailure()).toBe(true));
    expect(task.lastError.name).toBe('AbortError');
    expect(task.processProgress).toBe(0);
    expect(task.encodeController).toBeNull();
  });
});

// The GIF tests above cover encodeFrames' progress, failure and stop, which APNG shares.
describe('APNG in the browser', () => {
  const apngTask = id => createTask({ id, taskId: `pixiv:${id}:apng`, convertType: 'apng' });

  beforeEach(() => {
    encodeApng.mockResolvedValue({ data: new Uint8Array([4, 5, 6]), mimeType: 'image/apng', extension: 'apng' });
  });

  test('encodes each frame with its delay and saves the APNG', async () => {
    const task = apngTask('210');

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    expect(savedNames()).toEqual(['ugoira/210_Moving.apng']);
    expect(saved[0].blob.type).toBe('image/apng');
    expect(new Uint8Array(await saved[0].blob.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6]));
    expect(encodeGif).not.toHaveBeenCalled();
    expect(encodeVideo).not.toHaveBeenCalled();

    const [{ frames: encoded, signal }] = encodeApng.mock.calls[0];
    expect(signal.aborted).toBe(false);
    expect(encoded.map(frame => frame.delay)).toEqual([100, 250]);
    expect(await Promise.all(encoded.map(frame => frame.image.text()))).toEqual(['frame 0', 'frame 1']);
  });

  test.each([['image/jpeg', '211'], ['image/png', '212']])("labels %s frames with the ugoira's mime type", async (mimeType, id) => {
    const task = apngTask(id);
    task.context.illustMimeType = mimeType;

    task.start();
    await completeDownload(task);
    await vi.waitFor(() => expect(task.isComplete()).toBe(true));

    const [{ frames: encoded }] = encodeApng.mock.calls[0];
    expect(encoded.map(frame => frame.image.type)).toEqual([mimeType, mimeType]);
  });
});
