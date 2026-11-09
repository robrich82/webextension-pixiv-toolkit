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
 * @property {'txt'|'epub'} bookType
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

  async makeEpubBook() {
    let epubMaker = new EpubMaker();
    epubMaker.withTemplate('idpf-wasteland');
    epubMaker.withUuid(this.url);
    epubMaker.withAuthor(this.context.userName);
    epubMaker.withAttributionUrl(this.context.url);
    epubMaker.withCover(this.context.coverUrl);
    epubMaker.withTitle(this.title);

    if (this.options.includeDescription) {
      epubMaker.withSection(new EpubMaker.Section('bodymatter', null, {
        content: this.context.description
      }, false, false));
    }

    this.context.sections.forEach(section => {
      epubMaker.withSection(new EpubMaker.Section('bodymatter', null, {
        content: section
      }, false, false));
    });

    // downloadEpub() resolves nothing and saves through FileSaver, which isn't loaded.
    await this.saveBook(await epubMaker.makeEpub(), 'epub');
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
   * @param {'txt'|'epub'} extension
   */
  async saveBook(blob, extension) {
    let url = URL.createObjectURL(blob);
    let nameFormatter = NameFormatter.getFormatter({ context: this.context });

    try {
      this.lastDownloadId = await FileSystem.getDefault().saveFileInBackground({
        url,
        filename: pathjoin(GlobalSettings().downloadRelativeLocation, nameFormatter.format(
          this.options.renameRule,
          this.context.id + '_' + this.context.title
        )) + '.' + extension
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Builds and saves the book. A task that isn't pending (running or done) isn't started again.
   * @override
   */
  async start() {
    if (!this.isPending()) {
      return;
    }

    this.changeState(this.DOWNLOADING_STATE);
    this.dispatch('start');

    try {
      if (this.options.bookType === 'epub') {
        await this.makeEpubBook();
      } else {
        await this.makeTxtBook();
      }
    } catch (error) {
      this.lastError = error;
      this.changeState(this.FAILURE_STATE);
      this.dispatch('failure');
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
