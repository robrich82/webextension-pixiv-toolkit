import GlobalSettings from "@/modules/GlobalSettings";
import AbstractDownloadTask from "../AbstractDownloadTask";
import browser from "@/modules/Extension/browser";
import Downloader from "@/modules/Net/Downloader";
import FileSystem from "../../FileSystem";
import NameFormatter from "@/modules/Util/NameFormatter";
import MimeType from "@/modules/Util/MimeType";
import pathjoin from "@/modules/Util/pathjoin";

class ZipRepo {
  /**
   * @type {ZipRepo}
   */
  static instance;

  container = new Map();

  static getDefault() {
    if (!ZipRepo.instance) {
      ZipRepo.instance = new ZipRepo();
    }

    return ZipRepo.instance;
  }

  storeZip(uid, data) {
    this.container.set(uid, data);
  }

  getZip(uid) {
    const zip = this.container.get(uid);

    if (zip) {
      return zip;
    }
  }
}

/**
 * @typedef UgoiraDownloadTaskOptions
 * @property {string} uid
 * @property {string} id
 * @property {string} url
 * @property {string} resource
 * @property {any[]} frames
 * @property {string} renameRule
 * @property {0|1|2} packAnimationJsonType
 * @property {string} ffmpegCommandArgs
 * @property {any} context
 * @property {string} convertType
 *
 * @class
 */
class UgoiraDownloadTask extends AbstractDownloadTask {
  /**
   * @inheritdoc
   */
  type = 'PIXIV_UGOIRA';

  /**
   * @type {UgoiraDownloadTaskOptions}
   */
  options;

  /**
   * @type {Downloader}
   */
  downloader;

  /**
   * @type {Blob} Download data
   */
  data;

  /**
   * @type {number} Count processed frames
   */
  processedFramesCount = 0;

  /**
   * @type {number} FFmpeg process progress
   */
  processProgress = 0;

  /**
   * @type {import("@ffmpeg/ffmpeg").FFmpeg}
   */
  ffmpeg;

  zip;

  /**
   * @type {boolean} The frames zip is saved
   */
  zipSaved = false;

  /**
   *
   * @param {UgoiraDownloadTaskOptions} options
   */
  constructor(options) {
    super();

    this.uid = options.uid;
    this.id = options.id;
    this.url = options.url;
    this.title = options.context.title;
    this.context = options.context;
    this.options = options;

    this.downloader = new Downloader({ processors: GlobalSettings().downloadTasksWhenDownloadingImages });
    this.downloader.appendFile(options.resource);
    this.downloader.addListener('start', this.onStart, this);
    this.downloader.addListener('progress', this.onProgress, this);
    this.downloader.addListener('item-finish', this.onItemFinish, this);
    this.downloader.addListener('finish', this.onFinish, this);
    this.downloader.addListener('failure', this.onFailure, this);
    this.downloader.addListener('item-error', this.onItemError, this);
    this.downloader.addListener('pause', this.onPause, this);
  }

  /**
   * Handle downloader `onStart` event
   */
  onStart() {
    //
  }

  /**
   * Handle downloader `onProgress` event
   * @param {{progress: number, successCount: number, failCount: number}} param0
   * @fires UgoiraDownloadTask#progress
   */
  onProgress({ progress, successCount, failCount}) {
    this.progress = progress;

    this.dispatch('progress', [this.progress]);
  }

  makeAnimationJsonContent(type) {
    if (type == 1) {
      return JSON.stringify(this.context.illustFrames);
    } else if (type == 2) {
      return JSON.stringify({
        ugokuIllustData: {
          src: this.context.illustSrc,
          originalSrc: this.context.illustOriginalSrc,
          mime_type: this.context.illustMimeType,
          frames: this.context.illustFrames
        }
      })
    }
  }

  /**
   *
   * @param {*} param0
   * @fires UgoiraDownloadTask#progress
   */
  async onItemFinish({ blob, mimeType }) {
    this.data = blob;

    let nameFormatter = NameFormatter.getFormatter({ context: this.context });

    this.zip = new JSZip();
    this.zipLoaded = this.zip.loadAsync(blob);
    await this.zipLoaded;

    if (this.options.packAnimationJsonType > 0) {
      this.zip.file('animation.json', this.makeAnimationJsonContent(this.options.packAnimationJsonType));
    }

    // A retry after info.json failed to save downloads the zip again, but mustn't save it twice.
    if (!this.zipSaved) {
      let url = URL.createObjectURL(await this.zip.generateAsync({ type: 'blob' }));
      let downloadId;

      try {
        downloadId = this.lastDownloadId = await FileSystem.getDefault().saveFileInBackground({
          url,
          filename: pathjoin(GlobalSettings().downloadRelativeLocation, nameFormatter.format(
            this.options.renameRule
          )) + '.' + MimeType.getExtenstion(mimeType)
        });
      } finally {
        FileSystem.getDefault().revokeWhenSaved(downloadId, url);
      }

      this.zipSaved = true;
    }

    this.dispatch('progress', [this.progress]);

    /**
     * Save work information accroding the enableDownloadMetadata setting
     */
    if (GlobalSettings().enableDownloadMetadata && this.options.context) {
      const infoUrl = URL.createObjectURL(new Blob([JSON.stringify(this.options.context)], { type: 'application/json' }));

      let infoDownloadId;

      try {
        // Beside the zip, named after the work.
        infoDownloadId = await FileSystem.getDefault().saveFileInBackground({
          url: infoUrl,
          filename: pathjoin(GlobalSettings().downloadRelativeLocation, nameFormatter.format(
            this.options.renameRule
          )) + '.info.json'
        });
      } finally {
        FileSystem.getDefault().revokeWhenSaved(infoDownloadId, infoUrl);
      }
    }

    // Cached for another conversion of the same work only once everything saved, so a retry downloads again.
    ZipRepo.getDefault().storeZip(this.uid, blob);
  }

  /**
   *
   * @param {(args: { data: any, outputFilename: string}) => void} completeHandler
   * @returns
   */
  async runFFmpeg(completeHandler) {
    /**
     * FFmpeg loaded as external library
     */
    let { FFmpeg } = FFmpegWASM;
    this.ffmpeg = new FFmpeg();
    this.ffmpeg.on('log', ({ message }) => console.log(message));
    this.ffmpeg.on('progress', ({ progress }) => {
      this.processProgress = progress;

      this.dispatch('progress', [this.processProgress]);
    });

    try {
      const ffmpegBaseUrl = browser.runtime.getURL('lib/ffmpeg/');
      await this.ffmpeg.load({
        coreURL: ffmpegBaseUrl + 'ffmpeg-core.js',
        wasmURL: ffmpegBaseUrl + 'ffmpeg-core.wasm',
      });

      await this.zipLoaded;

      let loadedFiles = [];

      /**
       * Add files to ffmpeg file system
       */
      for (let i = 0; i < this.options.frames.length; i++) {
        let frame = this.options.frames[i];
        let data = await this.zip.file(frame.file).async('uint8array');
        let indexStr = i + '';
        let filename = '0'.repeat(6 - indexStr.length) + i + '.jpg';
        await this.ffmpeg.writeFile(filename, data);
        loadedFiles.push(filename);
      }

      /**
       * parse ffmpeg command line(s)
       */
      const ffmpegCommands = [];
      const ffmpegCommandSetting = this.options.ffmpegCommandArgs ?
        this.options.ffmpegCommandArgs.trim() :
        null;

      if (!ffmpegCommandSetting) {
        ffmpegCommands.push(['-f', 'concat', '-i', 'input.txt', '-plays', '0', 'out.gif']);
      } else {
        const lines = ffmpegCommandSetting.split(/\r\n|\n|\r/);

        lines.forEach(line => {
          ffmpegCommands.push(line.trim().split(' '));
        });
      }

      const lastCommand = ffmpegCommands[ffmpegCommands.length - 1];
      const outputFilename = lastCommand[lastCommand.length - 1];

      /**
       * Add frames to ffmpeg file system
       */
      await this.ffmpeg.writeFile('input.txt', UgoiraDownloadTask.prepareConversion(ffmpegCommands, this.options.frames));
      loadedFiles.push('input.txt');

      for (const seq in ffmpegCommands) {
        console.log(ffmpegCommands[seq]);
        await this.ffmpeg.exec(ffmpegCommands[seq]);
      }

      await completeHandler.call(this, {
        data: await this.ffmpeg.readFile(outputFilename),
        outputFilename
      });

      loadedFiles.push(outputFilename);

      /**
       * Clearup assets
       */
      await Promise.all(loadedFiles.map(file => this.ffmpeg.deleteFile(file)));
    } finally {
      this.ffmpeg.terminate();
      this.ffmpeg = null;
    }
  }

  /**
   * The tick input.txt gives each frame, as the frame rate `1000/<tick>`. Without it the concat
   * demuxer reads the JPEG frames at the image demuxer's default 25 fps and rounds every delay to
   * 40ms (#322). The tick is the largest step every delay is a multiple of, so an output at a
   * constant frame rate repeats frames no more often than the delays need.
   *
   * The tick is at least 10ms: x264 picks the H.264 level from this rate, and delays like 33/34ms
   * would otherwise ask for 1000 fps, a level hardware decoders refuse. Frames then start on the
   * nearest 10ms.
   * @param {{ delay: number }[]} frames Delays that aren't a positive whole number of ms are skipped
   * @returns {number|undefined} in ms; undefined when no delay is usable
   */
  static tick(frames) {
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const step = frames
      .map(frame => frame.delay)
      .filter(UgoiraDownloadTask.usableDelay)
      .reduce(gcd, 0);

    return step ? Math.max(step, 10) : undefined;
  }

  /**
   * @param {*} delay
   * @returns {boolean} whether the delay is a positive whole number of ms
   */
  static usableDelay(delay) {
    return Number.isInteger(delay) && delay > 0;
  }

  /**
   * @param {string[]} command The last command; its output is its last argument
   * @returns {'gif'|'apng'|'video'} from an output `-f`, else from the output's extension
   */
  static outputFormat(command) {
    const muxer = command.lastIndexOf('-f');
    const format = muxer > command.lastIndexOf('-i') ?
      command[muxer + 1] :
      /\.(gif|apng)$/i.exec(command[command.length - 1])?.[1];

    return ['gif', 'apng'].find(name => name === format?.toLowerCase()) ?? 'video';
  }

  /**
   * Browsers play an animated image's frame of 10ms or less for 100ms, so a GIF's or APNG's
   * positive delays under 20ms are raised to 20ms, which also keeps a GIF frame (stored in 10ms
   * steps) from rounding down to 10ms.
   * @param {{ file: string, delay: number }[]} frames
   * @param {'gif'|'apng'|'video'} format
   * @returns {{ file: string, delay: number }[]}
   */
  static timedFrames(frames, format) {
    const minDelay = format === 'video' ? 0 : 20;

    return frames.map(frame =>
      (frame.delay > 0 && frame.delay < minDelay ? { ...frame, delay: minDelay } : frame));
  }

  /**
   * Adds -safe 0 to the commands and -final_delay to the last, and returns input.txt.
   * @param {string[][]} commands Changed in place
   * @param {{ file: string, delay: number }[]} frames
   * @returns {string}
   */
  static prepareConversion(commands, frames) {
    const lastCommand = commands[commands.length - 1];
    const format = UgoiraDownloadTask.outputFormat(lastCommand);

    commands.forEach(UgoiraDownloadTask.allowConcatOptions);
    UgoiraDownloadTask.holdLastFrame(lastCommand, frames, format);

    return UgoiraDownloadTask.concatList(frames, format);
  }

  /**
   * input.txt: the concat demuxer's list of frames, each with its delay and the frame rate.
   *
   * The demuxer ignores the last entry's duration (#325), so a video's last frame would last one
   * tick. A longer one is shortened by a tick and repeated for that tick. GIF and APNG get
   * -final_delay instead (holdLastFrame).
   * @param {{ file: string, delay: number }[]} frames
   * @param {'gif'|'apng'|'video'} [format='video']
   * @returns {string}
   */
  static concatList(frames, format = 'video') {
    const timed = UgoiraDownloadTask.timedFrames(frames, format);
    const tick = UgoiraDownloadTask.tick(timed);
    const entries = timed.map(frame => ({ file: frame.file, duration: frame.delay }));
    const last = entries[entries.length - 1];

    if (format === 'video' && UgoiraDownloadTask.usableDelay(last?.duration) && last.duration > tick) {
      last.duration -= tick;
      entries.push({ file: last.file });
    }

    return entries.map(({ file, duration }) =>
      `file '${file}'\r\n` +
      (tick ? `option framerate 1000/${tick}\r\n` : '') +
      (duration === undefined ? '' : `duration ${duration / 1000}\r\n`)
    ).join('');
  }

  /**
   * The GIF and APNG muxers give the last frame the delay before it, so `-final_delay` gives it its
   * own, unless the command sets one. GIF takes 10ms units and APNG seconds, each up to 65535. A
   * video is left alone.
   * @param {string[]} args The command writing the output, changed in place
   * @param {{ delay: number }[]} frames
   * @param {'gif'|'apng'|'video'} format
   */
  static holdLastFrame(args, frames, format) {
    const [last] = UgoiraDownloadTask.timedFrames(frames.slice(-1), format);

    if (format === 'video' || !UgoiraDownloadTask.usableDelay(last?.delay) || args.includes('-final_delay')) {
      return;
    }

    args.splice(args.length - 1, 0, '-final_delay', format === 'gif' ?
      String(Math.min(Math.round(last.delay / 10), 65535)) :
      `${Math.min(last.delay, 65535000)}/1000`);
  }

  /**
   * input.txt's `option` lines need the concat demuxer's unsafe mode, so each `-f concat` input
   * that reads input.txt (in any directory), custom commands included, gets `-safe 0`: added
   * before its `-i`, or replacing the value of its own `-safe`. input.txt only names the frame
   * files written here.
   * @param {string[]} args A command's arguments, changed in place
   */
  static allowConcatOptions(args) {
    let start = 0; // where the current input's options begin: after the previous input's file

    for (let i = 0; i < args.length - 1; i++) {
      if (args[i] !== '-i') {
        continue;
      }

      const options = args.slice(start, i);

      if (/(^|[/:])input\.txt$/.test(args[i + 1]) && options.includes('concat')) {
        const safe = options.lastIndexOf('-safe');

        if (safe > -1 && safe < options.length - 1) {
          args[start + safe + 1] = '0';
        } else {
          args.splice(i, 0, '-safe', '0');
          i += 2;
        }
      }

      start = i + 2;
    }
  }

  /**
   * When resource is downloaded, then generate animation file using ffmpeg
   * @fires UgoiraDownloadTask#progress
   * @fires UgoiraDownloadTask#complete
   * @fires UgoiraDownloadTask#failure
   */
  async onFinish() {
    this.changeState(this.PROCESSING_STATE);

    try {
      await this.convert();
    } catch (error) {
      console.error(`Could not convert ugoira ${this.id}`, error);
      this.lastError = error;
      this.onFailure();
      return;
    }

    this.changeState(this.COMPLETE_STATE);
    this.dispatch('complete');
  }

  async convert() {
    await this.runFFmpeg(async ({ data, outputFilename }) => {
      /**
       * Save file to disk
       */
      let animationFileUrl = URL.createObjectURL(new Blob([data], { type: MimeType.getFileMimeType(outputFilename) }));
      let nameFormatter = NameFormatter.getFormatter({ context: this.context });
      let downloadId;

      try {
        downloadId = this.lastDownloadId = await FileSystem.getDefault().saveFileInBackground({
          url: animationFileUrl,
          filename: pathjoin(GlobalSettings().downloadRelativeLocation, nameFormatter.format(
            this.options.renameRule
          )) + '.' + MimeType.getFileExtension(outputFilename)
        });
      } finally {
        FileSystem.getDefault().revokeWhenSaved(downloadId, animationFileUrl);
      }
    });
  }

  /**
   *
   * @param {*} error
   * @fires UgoiraDownloadTask#error
   */
  onItemError(error) {
    this.lastError = error;

    this.dispatch('error');
  }

  /**
   * Handle downloader abort event
   * @fires UgoiraDownloadTask#pause
   */
  onPause() {
    this.dispatch('pause');
  }

  /**
   * Create a pixiv illustration download task
   * @param {UgoiraDownloadTaskOptions} options
   * @returns {UgoiraDownloadTask}
   */
  static create(options) {
    return new UgoiraDownloadTask(options);
  }

  /**
   * @override
   * @fires UgoiraDownloadTask#start
   * @param {boolean} reset
   */
  async start(reset = false) {
    if (reset) {
      this.downloader.reset();
    }

    if (this.isPending()) {
      // Leave pending before any await, or a start() while the cached zip loads would convert it twice.
      this.changeState(this.DOWNLOADING_STATE);
      this.dispatch('start');
      this.zipRepo = ZipRepo.getDefault();

      /**
       * Here we get the zip file from cache repo, if get one then skip the download
       * process and start download onFinish event handler manully.
       */
      const data = this.zipRepo.getZip(this.uid);

      if (data) {
        this.data = data;
        this.zip = new JSZip();
        this.zipLoaded = this.zip.loadAsync(this.data);
        await this.zipLoaded;
        this.progress = 1;
        this.dispatch('progress', [this.progress]);
        this.onFinish();
      } else {
        this.downloader.download();
      }
    }
  }

  abortProcess() {
    if (this.downloader) {
      this.downloader.pause();
    }

    if (this.ffmpeg) {
      this.ffmpeg.terminate();
      this.processProgress = this.processedFramesCount = 0;
    }
  }

  /**
   * If the task is start to generate animation, then it can be stopped.
   * @override
   */
  pause() {
    if (this.state !== this.PROCESSING_STATE) {
      this.changeState(this.PAUSED_STATE);
      this.abortProcess();
    }
  }

  /**
   * @override
   */
  stop() {
    this.abortProcess();
  }

  /**
   * Convert task instance to json object
   * @return {object}
   */
  toJson() {
    return Object.assign({}, super.toJson(), {
      processProgress: this.processProgress,
      convertType: this.options.convertType
    });
  }
}

export default UgoiraDownloadTask;
