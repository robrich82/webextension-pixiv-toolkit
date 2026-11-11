import GlobalSettings from "@/modules/GlobalSettings";
import {
  PixivIllustDownloadTask as IllustDownloadTask,
  PixivMangaDownloadTask as MangaDownloadTask,
  PixivUgoiraDownloadTask as UgoiraDownloadTask
} from "@/options_page/modules/DownloadTasks";
import AbstractDownloadTask from "../../DownloadTasks/AbstractDownloadTask";
import AbstractResource from "@/modules/PageResource/AbstractResource";
import IllustResource from "@/modules/PageResource/Pixiv/IllustResource";

/**
 * The ugoira conversions offered as buttons. MP4 is re-encoded to H.264 (frames copied as is make
 * MJPEG, which browsers don't play), and yuv420p needs even dimensions, hence the pad. Variable
 * frame rate keeps one frame per ugoira frame; FFmpeg 5.1 would otherwise repeat them at
 * input.txt's frame rate.
 */
export const UGOIRA_FFMPEG_CLI_ARGS = {
  ugoiraFFmpegGIFCliArgs: '-f concat -i input.txt -plays 0 out.gif',
  ugoiraFFmpegAPNGCliArgs: '-f concat -i input.txt -plays 0 output.apng',
  ugoiraFFmpegWEBMCliArgs: '-f concat -i input.txt -safe 0 output.webm',
  ugoiraFFmpegMP4CliArgs: '-f concat -i input.txt -safe 0 -c:v libx264 -pix_fmt yuv420p -vf pad=ceil(iw/2)*2:ceil(ih/2)*2 -fps_mode vfr -movflags +faststart output.mp4'
};

class IllustAdapter {
  /**
   * @type {Object}
   */
  settings;

  /**
   * @type {string} Target page url
   */
  url;

  /**
   * @type {object} Target context data
   */
  context;

  /**
   * @constructor
   * @param {string} url Target page url
   */
  constructor(url) {
    this.settings = GlobalSettings();
    this.url = url;
  }

  /**
   * Create a adapter instance
   * @param {string} url Target page url
   * @returns {IllustAdapter}
   */
  static create(url) {
    return new IllustAdapter(url);
  }

  /**
   * @param {AbstractResource} resource
   * @param {Object} options
   * @returns {IllustDownloadTask}
   */
  createIllustDownloadTask(resource, options) {
    return IllustDownloadTask.create({
      id: resource.getUid(),
      url: this.url,
      pages: this.context.pages,
      selectedIndexes: options.selectedIndexes,
      renameRule:  this.settings.illustRenameRule,
      renameImageRule: this.settings.illustRenameImageRule,
      pageNumberStartWithOne: this.settings.illustrationPageNumberStartWithOne === -2 ?
                              this.settings.globalTaskPageNumberStartWithOne :
                              this.settings.illustrationPageNumberStartWithOne,
      pageNumberLength: this.settings.illustrationPageNumberLength === -2 ?
                        this.settings.globalTaskPageNumberLength :
                        this.settings.illustrationPageNumberLength,
      context: this.context,
    });
  }

  /**
   * @param {AbstractResource} resource
   * @param {Object} options
   * @returns {MangaDownloadTask}
   */
  createMangaDownloadTask(resource, options) {
    return MangaDownloadTask.create({
      id: resource.getUid(),
      url: this.url,
      pages: this.context.pages,
      selectedIndexes: options.selectedIndexes,
      renameRule: this.settings.mangaRenameRule,
      renameImageRule: this.settings.mangaRenameImageRule,
      pageNumberStartWithOne: this.settings.mangaPageNumberStartWithOne === -2 ?
                              this.settings.globalTaskPageNumberStartWithOne :
                              this.settings.mangaPageNumberStartWithOne,
      pageNumberLength: this.settings.mangaPageNumberLength === -2 ?
                        this.settings.globalTaskPageNumberLength :
                        this.settings.mangaPageNumberLength,
      context: this.context,
    });
  }

  /**
   * @param {AbstractResource} resource
   * @param {Object} options
   * @returns {UgoiraDownloadTask}
   */
  createUgoiraDownloadTask(resource, options) {
    let ffmpegCommandArgs = this.settings.ugoiraCustomFFmpegCommand;
    let convertType = 'CUSTOM';

    if (options && typeof options.ugoiraConvertType === 'string') {
      const key = `ugoiraFFmpeg${options.ugoiraConvertType.toUpperCase()}CliArgs`;

      if (UGOIRA_FFMPEG_CLI_ARGS[key]) {
        ffmpegCommandArgs = UGOIRA_FFMPEG_CLI_ARGS[key];
        convertType = options.ugoiraConvertType;
      }
    }

    const downloadTask = UgoiraDownloadTask.create({
      uid: resource.getUid(),
      id: resource.getDownloadTaskId(convertType),
      url: this.url,
      resource: this.context.illustOriginalSrc,
      frames: this.context.illustFrames,
      packAnimationJsonType: this.settings.animationJsonFormat,
      renameRule: this.settings.ugoiraRenameRule,
      ffmpegCommandArgs,
      context: this.context,
      convertType
    });

    return downloadTask;
  }

  /**
   * Create non-options setted download task instance
   * @param {IllustResource} resource
   * @param {Object} options
   * @returns {AbstractDownloadTask}
   */
  async createDownloadTask(resource, options) {
    this.context = resource.getContext();

    /**
     * Append current url to context
     */
    this.context.targetUrl = this.url;

    if (resource.isIllust()) {
      return this.createIllustDownloadTask(resource, options);
    } else if (resource.isManga()) {
      return this.createMangaDownloadTask(resource, options);
    } else if (resource.isUgoira()) {
      return this.createUgoiraDownloadTask(resource, options);
    }
  }
}

export default IllustAdapter;
