import GlobalSettings from "@/modules/GlobalSettings";
import AbstractDownloadTask from "./AbstractDownloadTask";
import Downloader from "@/modules/Net/Downloader";
import FileSystem from "../FileSystem";
import NameFormattor from "@/modules/Util/NameFormatter";
import MimeType from "@/modules/Util/MimeType";
import pathjoin from "@/modules/Util/pathjoin";
import browser from "@/modules/Extension/browser";
import { fixFilename } from "@/modules/Util";

/**
 * @typedef MultipleDownloadTaskOptions
 * @property {string} id
 * @property {string} url
 * @property {string[]} pages
 * @property {number[]} selectedIndexes
 * @property {string} [renameRule]
 * @property {string} [renameImageRule]
 * @property {number} pageNumberStartWithOne
 * @property {number} pageNumberLength
 * @property {any} context
 *
 * @class
 */
class MultipleDownloadTask extends AbstractDownloadTask {
  /**
   * @inheritdoc
   */
  type = 'UNDEFINED';

  /**
   * @type {MultipleDownloadTaskOptions}
   */
  options;

  /**
   * @type {JSZip}
   */
  zip;

  /**
   * @type {Downloader}
   */
  downloader;

  /**
   *
   * @param {MultipleDownloadTaskOptions} options
   */
  constructor(options) {
    super();

    this.now = new Date();
    this.now.setMinutes(this.now.getMinutes() - this.now.getTimezoneOffset());
    this.options = options;
    this.id = options.id;
    this.url = options.url;
    this.state = this.PENDING_STATE;
    this.title = options.context.title;
    this.context = options.context;
    this.zip = new JSZip();
    this.zipMultipleImages = GlobalSettings().globalZipMultipleImages;
    this.downloader = new Downloader({
      processors: GlobalSettings().downloadTasksWhenDownloadingImages
    });
    this.downloader.addListener('start', this.onStart, this);
    this.downloader.addListener('progress', this.onProgress, this);
    this.downloader.addListener('item-finish', this.onItemFinish, this);
    this.downloader.addListener('finish', this.onFinish, this);
    this.downloader.addListener('item-error', this.onItemError, this);
    this.downloader.addListener('pause', this.onPause, this);

    if (this.options.selectedIndexes && this.options.selectedIndexes.length > 0) {
      this.options.pages.forEach((page, index) => {
        if (this.options.selectedIndexes.indexOf(index) > -1) {
          this.downloader.appendFile(page, { index });
        }
      });
    } else {
      this.options.pages.forEach((page, index) => this.downloader.appendFile(page, { index }));
    }
  }

  /**
   *
   * @param {number|string} pageNum
   * @returns {number|string}
   */
  buildPageNum(pageNum) {
    if (typeof pageNum !== 'number') {
      pageNum = parseInt(pageNum);
    }

    if (this.options.pageNumberStartWithOne) {
      pageNum++;
    }

    let pageNumberLength;

    if (this.options.pageNumberLength > 1) {
      pageNumberLength = this.options.pageNumberLength;
    } else if (this.options.pageNumberLength == -1) {
      pageNumberLength = `${this.context.totalPages}`.length;
    }

    if (pageNumberLength) {
      if (`${pageNum}`.length >= pageNumberLength) {
        return pageNum;
      } else {
        return '0'.repeat(pageNumberLength - `${pageNum}`.length) + pageNum;
      }
    } else {
      return pageNum;
    }
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
   * @fires MultipleDownloadTask#progress
   */
  onProgress({ progress, successCount, failCount}) {
    this.progress = progress;
    this.dispatch('progress', [this.progress]);
  }

  shouldZipFile() {
    if (GlobalSettings().downloadSaveMode !== 0) {
      return false;
    }

    return this.zipMultipleImages === 1 ||
      (this.zipMultipleImages === 2 && this.options.pages.length > 1) ||
      (this.zipMultipleImages === 3 && this.downloader.files.length > 1 );
  }

  /**
   * The response's `Content-Type` header is the primary source for a file's
   * extension, but some responses (e.g. Fanbox's zip attachment downloads)
   * don't send one at all - fall back to the extension on the source URL
   * itself in that case, rather than producing a `.null` filename. Fanbox
   * attachment URLs are signed CDN links (`...archive.zip?X-Amz-...`), so
   * the query string is stripped first - otherwise the "extension" would be
   * `zip?X-Amz-Signature=...`.
   * @param {string} mimeType
   * @param {string} pageUrl
   * @returns {string}
   */
  resolveExtension(mimeType, pageUrl) {
    return MimeType.getExtenstion(mimeType) || MimeType.getFileExtension(pageUrl.split(/[?#]/)[0]);
  }

  /**
   * True when the post has exactly one page and that page is itself an
   * archive (e.g. a Fanbox post whose attachment is a .zip file). Such
   * content shouldn't be re-zipped or dropped into a per-post work folder -
   * it should just be saved as `<post name>.<ext>` directly.
   * @param {string} mimeType
   * @param {string} pageUrl
   * @returns {boolean}
   */
  isSingleArchivePage(mimeType, pageUrl) {
    return this.downloader.files.length === 1 && this.resolveExtension(mimeType, pageUrl) === 'zip';
  }

  /**
   * A rename rule can contain a `{pageNum}` path segment - the shipped
   * `fanboxPostRenameRule` default is `{id}_{title}/{pageNum}` - meant for
   * the per-page "work folder" branch below, where each item is formatted
   * with its own page number in context. When naming something that stands
   * for the whole post instead (the single zip archive, or a lone page
   * that's already an archive and is saved as-is), there is no page number
   * to plug in, so that segment is dropped rather than left as a literal,
   * unresolved `{pageNum}` token - which, since the rule contains a `/`,
   * would otherwise split into a bogus subfolder around it.
   * @returns {string}
   */
  formatPostName() {
    const rule = (this.options.renameRule || '')
      .split(/[/\\]/)
      .filter(segment => !/\{pageNum\}/i.test(segment))
      .join('/');

    return NameFormattor.getFormatter({ context: Object.assign({}, this.context) })
      .format(rule, this.context.id);
  }

  dontCreateWorkFolder() {
    if (GlobalSettings().downloadSaveMode !== 1) {
      return false;
    }

    const dontCreateWorkFolderSetting = GlobalSettings().dontCreateWorkFolder;

    return dontCreateWorkFolderSetting === 2 ||
      (dontCreateWorkFolderSetting === 1 && this.options.pages.length === 1) ||
      (dontCreateWorkFolderSetting === 3 && this.downloader.files.length === 1)
  }

  /**
   *
   * @param {*} param0
   * @fires MultipleDownloadTask#progress
   */
  async onItemFinish({ blob, args, mimeType }) {
    let url = URL.createObjectURL(blob);
    let pageNum = this.buildPageNum(args.index);
    let pageUrl = this.options.pages[args.index];
    let nameFormatter = NameFormattor.getFormatter({
      context: Object.assign({}, this.context, { pageNum })
    });

    if (this.isSingleArchivePage(mimeType, pageUrl)) {
      const filename = pathjoin(
        GlobalSettings().downloadRelativeLocation,
        this.formatPostName()
      ) + `.${this.resolveExtension(mimeType, pageUrl)}`;

      this.lastDownloadId = await browser.runtime.sendMessage({
        to: 'ws',
        action: 'download:saveFile',
        args: {
          url,
          filename: fixFilename(filename)
        }
      });

      this.singleArchivePageSaved = true;
    } else if (this.shouldZipFile()) {
      const file = nameFormatter.format(this.options.renameImageRule, `p${pageNum}`) + `.${this.resolveExtension(mimeType, pageUrl)}`;
      this.zip.file(fixFilename(file), blob, { date: this.now });
    } else {
      let filename = GlobalSettings().downloadRelativeLocation;

      if (this.type !== 'PIXIV_MANGA' && this.dontCreateWorkFolder()) {
        filename = pathjoin(filename,
          nameFormatter.format((GlobalSettings().combinWRRuleAndIRRuleWhenDontCreateWorkFolder === 0 ? '' : (this.options.renameRule + '_')) + this.options.renameImageRule, `${this.context.id}-p${pageNum}`)
        ) + `.${this.resolveExtension(mimeType, pageUrl)}`;
      } else {
        filename = pathjoin(filename,
          nameFormatter.format(this.options.renameRule, this.context.id),
          nameFormatter.format(this.options.renameImageRule, `p${pageNum}`)
        ) + `.${this.resolveExtension(mimeType, pageUrl)}`;
      }

      this.lastDownloadId = await browser.runtime.sendMessage({
        to: 'ws',
        action: 'download:saveFile',
        args: {
          url,
          filename: fixFilename(filename)
        }
      });
    }

    URL.revokeObjectURL(url);

    this.dispatch('progress', [this.progress]);
  }

  /**
   * Override in download task
   * @returns {boolean}
   */
  canSaveInfo() {
    return false;
  }

  async saveInfo() {
    const metaFilename = 'info.json';
    const that = this;

    return new Promise(async resolve => {
      const blob = new Blob([JSON.stringify(that.options.context)], {
        type: 'application/json'
      });

      if (that.shouldZipFile()) {
        that.zip.file(metaFilename, blob, { date: this.now });
      } else {
        await browser.runtime.sendMessage({
          to: 'ws',
          action: 'download:saveFile',
          args: {
            url: URL.createObjectURL(blob),
            filename: metaFilename
          }
        })
      }
      resolve();
    });
  }

  /**
   * @fires MultipleDownloadTask#complete
   */
  async onFinish() {
    if (this.singleArchivePageSaved) {
      this.changeState(this.COMPLETE_STATE);
      this.dispatch('complete');
      return;
    }

    if (GlobalSettings().enableDownloadMetadata &&
      this.options.context &&
      this.canSaveInfo()
    ) {
      await this.saveInfo();
    }

    if (this.shouldZipFile()) {
      let filename = pathjoin(
        GlobalSettings().downloadRelativeLocation,
        this.formatPostName()
      );
      filename = fixFilename(filename);

      this.zip.generateAsync({ type: 'blob' }).then(async blob => {
        this.lastDownloadId = await browser.runtime.sendMessage({
          to: 'ws',
          action: 'download:saveFile',
          args: {
            url: URL.createObjectURL(blob),
            filename: filename + '.zip'
          }
        });

        this.changeState(this.COMPLETE_STATE);
        this.dispatch('complete');
      });
    } else {
      this.changeState(this.COMPLETE_STATE);
      this.dispatch('complete');
    }
  }

  /**
   *
   * @param {*} error
   * @fires MultipleDownloadTask#error
   */
  onItemError(error) {
    this.lastError = error;
    this.dispatch('error');
  }

  /**
   * @fires MultipleDownloadTask#pause
   */
  onPause() {
    //
  }

  /**
   * Create a pixiv illustration download task
   * @param {MultipleDownloadTaskOptions} options
   * @returns {MultipleDownloadTask}
   */
  static create(options) {
    return new MultipleDownloadTask(options);
  }

  /**
   * @override
   * @fires MultipleDownloadTask#start
   * @param {bollean} reset
   */
  start(reset = false) {
    if (reset) {
      this.downloader.reset();
    }

    if (this.isPending()) {
      this.changeState(this.DOWNLOADING_STATE);
      this.dispatch('start');
      this.downloader.download();
    }
  }

  /**
   * @override
   */
  pause() {
    this.changeState(this.PAUSED_STATE);
    this.downloader.pause();
  }

  /**
   * @override
   */
  stop() {
    this.downloader.pause();
  }
}

export default MultipleDownloadTask;
