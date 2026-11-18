import AbstractDownloadTask from "../AbstractDownloadTask";
import GlobalSettings from "@/modules/GlobalSettings";
import FileSystem from "../../FileSystem";
import NameFormatter from "@/modules/Util/NameFormatter";
import pathjoin from "@/modules/Util/pathjoin";

/**
 * @typedef NovelDownloadTaskOptions
 * @property {string} id
 * @property {string} url
 * @property {string} renameRule
 * @property {boolean} includeDescription
 * @property {any} context
 *
 * @class
 */
class NovelDownloadTask extends AbstractDownloadTask {
  /**
   * @inheritdoc
   */
  type = 'PIXIV_NOVEL';

  /**
   * @type {NovelDownloadTaskOptions}
   */
  options;

  /**
   *
   * @param {NovelDownloadTaskOptions} options
   */
  constructor(options) {
    super();

    this.id = options.id;
    this.url = options.url;
    this.state = this.PENDING_STATE;
    this.title = options.context.title;
    this.context = options.context;
    this.options = options;
  }

  /**
   * Create a pixiv illustration download task
   * @param {NovelDownloadTaskOptions} options
   * @returns {NovelDownloadTask}
   */
  static create(options) {
    return new NovelDownloadTask(options);
  }

  async makeTxtBook() {
    let contentParts = [];

    contentParts.push(this.url);
    contentParts.push(this.context.userName);
    contentParts.push(this.title);

    if (this.options.includeDescription) {
      contentParts.push(this.context.description.replace(/<br\s*\/>/ig, "\r\n").trim());
    }

    this.context.sections.forEach(section => {
      contentParts.push(section.replace(/<br\s*\/>/ig, "\r\n").trim());
    });

    let content = contentParts.join("\r\n".repeat(2));

    await this.saveBook(new Blob([content], { type: 'text/plain' }), 'txt');
  }

  /**
   * @param {Blob} blob
   * @param {string} extension
   */
  async saveBook(blob, extension) {
    let url = URL.createObjectURL(blob);
    let nameFormatter = NameFormatter.getFormatter({ context: this.context });
    let downloadId;

    try {
      downloadId = this.lastDownloadId = await FileSystem.getDefault().saveFileInBackground({
        url,
        filename: pathjoin(GlobalSettings().downloadRelativeLocation, nameFormatter.format(
          this.options.renameRule,
          this.context.id + '_' + this.context.title
        )) + '.' + extension
      });
    } finally {
      FileSystem.getDefault().revokeWhenSaved(downloadId, url);
    }
  }

  /**
   * Builds and saves the book. Only a pending task starts.
   * @override
   */
  async start() {
    if (!this.isPending()) {
      return;
    }

    this.changeState(this.DOWNLOADING_STATE);
    this.dispatch('start');

    try {
      await this.makeTxtBook();
    } catch (error) {
      console.error(`Could not save novel ${this.id}`, error);
      this.lastError = error;
      this.onFailure();
      return;
    }

    this.progress = 1;
    this.changeState(this.COMPLETE_STATE);
    this.dispatch('complete');
  }

  /**
   * @override
   */
  pause() {
    //
  }

  /**
   * @override
   */
  stop() {
    //
  }
}

export default NovelDownloadTask;
