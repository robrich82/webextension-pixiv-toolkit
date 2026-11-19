import GlobalSettings from "@/modules/GlobalSettings";
import {
  PixivIllustDownloadTask as IllustDownloadTask,
  PixivMangaDownloadTask as MangaDownloadTask,
  PixivUgoiraDownloadTask as UgoiraDownloadTask
} from "@/options_page/modules/DownloadTasks";
import AbstractDownloadTask from "../../DownloadTasks/AbstractDownloadTask";
import AbstractResource from "@/modules/PageResource/AbstractResource";
import IllustResource from "@/modules/PageResource/Pixiv/IllustResource";
import { VIDEO_CONTAINERS, codecSettingKey } from "@/options_page/modules/UgoiraEncoders/video";

/**
 * The ugoira conversions FFmpeg makes; GIF and VIDEO_CONTAINERS are encoded in the browser instead.
 */
export const UGOIRA_FFMPEG_CLI_ARGS = {
  ugoiraFFmpegAPNGCliArgs: '-f concat -i input.txt -plays 0 output.apng'
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
    const convertType = options?.ugoiraConvertType;
    // A zip task saves only the frames zip, and the browser encodes GIF and the video containers, so
    // none of them has an FFmpeg command.
    const isVideo = Object.hasOwn(VIDEO_CONTAINERS, convertType ?? '');
    const noCommand = isVideo ||
      [UgoiraDownloadTask.ZIP_CONVERT_TYPE, UgoiraDownloadTask.GIF_CONVERT_TYPE].includes(convertType);
    const ffmpegCommandArgs = noCommand ? '' : typeof convertType === 'string' &&
      UGOIRA_FFMPEG_CLI_ARGS[`ugoiraFFmpeg${convertType.toUpperCase()}CliArgs`];

    if (!noCommand && !ffmpegCommandArgs) {
      throw new Error(`Unknown ugoira convert type: ${convertType}`);
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
      convertType,
      codec: isVideo ? this.settings[codecSettingKey(convertType)] : undefined
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
