import GlobalSettings from "@/modules/GlobalSettings";
import AbstractDownloadTask from "../AbstractDownloadTask";
import Downloader from "@/modules/Net/Downloader";
import FileSystem from "../../FileSystem";
import NameFormatter from "@/modules/Util/NameFormatter";
import pathjoin from "@/modules/Util/pathjoin";
import { VIDEO_CONTAINERS, encodeVideo } from "../../UgoiraEncoders/video";
import { encodeGif } from "../../UgoiraEncoders/gif";
import { encodeApng } from "../../UgoiraEncoders/apng";

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

  removeZip(uid) {
    this.container.delete(uid);
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
 * @property {any} context
 * @property {string} convertType A button's format: 'zip' saves the frames zip, and the others encode in
 *   the browser
 * @property {string} [codec] For a video format, the codec to try first; unset, the container's default
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
   * @type {number} Conversion progress
   */
  processProgress = 0;

  zip;

  /**
   * The codec encoded instead of the one asked for; null when there was no fallback
   * @type {string|null}
   */
  fallbackCodec = null;

  /**
   * Counts start() calls, so a load that a pause and a restart overtook doesn't go on
   * @type {number}
   */
  startRun = 0;

  /**
   * The convertType of a task that saves the frames zip and converts nothing
   */
  static ZIP_CONVERT_TYPE = 'zip';

  /**
   * The convertType of a task that encodes a GIF in workers (UgoiraEncoders/gif)
   */
  static GIF_CONVERT_TYPE = 'gif';

  /**
   * The convertType of a task that encodes an APNG in workers (UgoiraEncoders/apng)
   */
  static APNG_CONVERT_TYPE = 'apng';

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
  async onItemFinish({ blob }) {
    this.data = blob;

    let nameFormatter = NameFormatter.getFormatter({ context: this.context });

    this.zip = new JSZip();
    this.zipLoaded = this.zip.loadAsync(blob);
    await this.zipLoaded;

    this.dispatch('progress', [this.progress]);

    /**
     * Save work information accroding the enableDownloadMetadata setting
     */
    if (GlobalSettings().enableDownloadMetadata && this.options.context) {
      const infoUrl = URL.createObjectURL(new Blob([JSON.stringify(this.options.context)], { type: 'application/json' }));

      let infoDownloadId;

      try {
        // Beside the zip or the animation, named after the work.
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

    // Cached for the work's other tasks only once info.json saved, so a retry after it failed downloads again.
    ZipRepo.getDefault().storeZip(this.uid, blob);
  }

  /**
   * Once the frames are downloaded, converts them to the task's format
   * @fires UgoiraDownloadTask#progress
   * @fires UgoiraDownloadTask#complete
   * @fires UgoiraDownloadTask#failure
   */
  async onFinish() {
    if (this.isDelete) {
      return;
    }

    this.changeState(this.PROCESSING_STATE);

    try {
      if (this.isZipOnly()) {
        await this.saveZip();
      } else {
        await this.convert();
      }
    } catch (error) {
      // A delete aborts the encoding or skips the save; the task is gone, so it ends quietly.
      if (this.isDelete) {
        return;
      }

      console.error(`Could not ${this.isZipOnly() ? 'save the frames zip of' : 'convert'} ugoira ${this.id}`, error);
      this.lastError = error;
      this.onFailure();
      return;
    }

    // Deleted while its file saved: it neither completes nor records history.
    if (this.isDelete) {
      return;
    }

    this.changeState(this.COMPLETE_STATE);
    this.dispatch('complete');
  }

  /**
   * Stops a deleted task before its next step; onFinish() swallows the error.
   * @throws {Error} The task was deleted.
   */
  throwIfDeleted() {
    if (this.isDelete) {
      throw new Error(`Ugoira task ${this.id} was deleted`);
    }
  }

  /**
   * @returns {boolean} the task saves the frames zip rather than converting them
   */
  isZipOnly() {
    return this.options.convertType === UgoiraDownloadTask.ZIP_CONVERT_TYPE;
  }

  /**
   * Saves the frames zip, with animation.json when packAnimationJsonType asks for it. Done
   * processing at once, which is what marks the content script's button done.
   * @fires UgoiraDownloadTask#progress
   */
  async saveZip() {
    await this.zipLoaded;

    if (this.options.packAnimationJsonType > 0) {
      this.zip.file('animation.json', this.makeAnimationJsonContent(this.options.packAnimationJsonType));
    }

    const zipBlob = await this.zip.generateAsync({ type: 'blob' });
    this.throwIfDeleted();

    const url = URL.createObjectURL(zipBlob);
    const nameFormatter = NameFormatter.getFormatter({ context: this.context });
    let downloadId;

    try {
      downloadId = this.lastDownloadId = await FileSystem.getDefault().saveFileInBackground({
        url,
        filename: pathjoin(GlobalSettings().downloadRelativeLocation, nameFormatter.format(
          this.options.renameRule
        )) + '.zip'
      });
    } finally {
      FileSystem.getDefault().revokeWhenSaved(downloadId, url);
    }

    this.processProgress = 1;
    this.dispatch('progress', [this.processProgress]);
  }

  async convert() {
    const format = this.options.convertType?.toLowerCase();
    let encoded;

    if (format === UgoiraDownloadTask.GIF_CONVERT_TYPE) {
      encoded = await this.encodeFrames(encodeGif);
    } else if (format === UgoiraDownloadTask.APNG_CONVERT_TYPE) {
      encoded = await this.encodeFrames(encodeApng);
    } else if (Object.hasOwn(VIDEO_CONTAINERS, format ?? '')) {
      encoded = await this.encodeVideo(format);
    } else {
      throw new Error(`Unknown ugoira convert type: ${this.options.convertType}`);
    }

    this.throwIfDeleted();
    await this.saveAnimation(encoded.data, encoded.mimeType, encoded.extension);
  }

  /**
   * Encodes the frames as a video through WebCodecs, each frame lasting its own delay.
   * @param {string} container A key of VIDEO_CONTAINERS
   * @returns {Promise<{ data: ArrayBuffer, mimeType: string, extension: string }>}
   */
  encodeVideo(container) {
    this.fallbackCodec = null;

    return this.encodeFrames(options => encodeVideo({
      ...options,
      container,
      codec: this.options.codec,
      // The next progress event marks the task changed, and the download manager's poll reads it.
      onCodec: ({ codec, fallback }) => {
        this.fallbackCodec = fallback ? codec : null;
      }
    }));
  }

  /**
   * Passes the frames and their delays to an encoder; stop() aborts it.
   * @template T
   * @param {(options: { frames: { image: Blob, delay: number }[], signal: AbortSignal, onProgress: (progress: number) => void }) => Promise<T>} encode
   * @returns {Promise<T>}
   */
  async encodeFrames(encode) {
    this.encodeController = new AbortController();
    // A retry starts from nothing, not from the failed attempt's progress.
    this.processProgress = 0;

    try {
      await this.zipLoaded;

      const frames = await Promise.all(this.options.frames.map(async frame => ({
        image: new Blob([await this.zip.file(frame.file).async('uint8array')], { type: this.context.illustMimeType || 'image/jpeg' }),
        delay: frame.delay
      })));

      this.throwIfDeleted();

      return await encode({
        frames,
        signal: this.encodeController.signal,
        onProgress: progress => {
          this.processProgress = progress;
          this.dispatch('progress', [this.processProgress]);
        }
      });
    } finally {
      this.encodeController = null;
    }
  }

  /**
   * @param {ArrayBuffer|Uint8Array} data
   * @param {string} mimeType
   * @param {string} extension
   */
  async saveAnimation(data, mimeType, extension) {
    let animationFileUrl = URL.createObjectURL(new Blob([data], { type: mimeType }));
    let nameFormatter = NameFormatter.getFormatter({ context: this.context });
    let downloadId;

    try {
      downloadId = this.lastDownloadId = await FileSystem.getDefault().saveFileInBackground({
        url: animationFileUrl,
        filename: pathjoin(GlobalSettings().downloadRelativeLocation, nameFormatter.format(
          this.options.renameRule
        )) + '.' + extension
      });
    } finally {
      FileSystem.getDefault().revokeWhenSaved(downloadId, animationFileUrl);
    }
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
      const run = ++this.startRun;
      // Paused, deleted, or paused and started again while the cached zip loaded (#438).
      const stillRunning = () => run === this.startRun && this.isDownloading() && !this.isDelete;
      this.dispatch('start');
      this.zipRepo = ZipRepo.getDefault();

      /**
       * Here we get the zip file from cache repo, if get one then skip the download
       * process and start download onFinish event handler manully.
       */
      const data = this.zipRepo.getZip(this.uid);

      if (data) {
        try {
          this.zip = new JSZip();
          this.zipLoaded = this.zip.loadAsync(data);
          await this.zipLoaded;
        } catch (error) {
          // A cached zip that won't load is dropped, and the work downloaded again.
          console.error(`Could not load the cached zip of ${this.uid}`, error);
          this.zipRepo.removeZip(this.uid);

          if (stillRunning()) {
            this.downloader.reset();
            this.downloader.download();
          }

          return;
        }

        if (!stillRunning()) {
          return;
        }

        this.data = data;
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

    if (this.encodeController) {
      this.encodeController.abort();
      this.processProgress = 0;
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
      convertType: this.options.convertType,
      fallbackCodec: this.fallbackCodec
    });
  }
}

export { ZipRepo };
export default UgoiraDownloadTask;
