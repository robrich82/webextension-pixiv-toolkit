import History from "@/modules/History";
import Db from "@/modules/Db/Db";
import { toHistoryItem } from "@/modules/HistoryItem";
import AbstractService from "./AbstractService";

/**
 * @class History service
 */
 class HistoryService extends AbstractService {
  /**
   * @type {HistoryService}
   */
  static instance;

  /**
   * @type {History}
   */
  history;

  /**
   * @constructor
   */
  constructor() {
    super();

    this.history = new History();
  }

  /**
   *
   * @returns {HistoryService}
   */
  static getService() {
    if (!HistoryService.instance) {
      HistoryService.instance = new HistoryService();
    }

    return HistoryService.instance;
  }

  /**
   * The settings page stores the raw field value, so this can be a string.
   */
  applyMaxHistoryItems() {
    let max = Number(this.application.settings.maxHistoryItems);

    this.history.setMax(Number.isInteger(max) && max > 0 ? max : 10000);
  }

  async saveItem(data) {
    this.applyMaxHistoryItems();

    if (this.application.settings.notSaveNSFWWorkInHistory) {
      if (!data.r) {
        await this.history.saveItem(data);
      }
    } else {
      await this.history.saveItem(data);
    }
  }

  async itemVisit(data) {
    if (data.visited_at) {
      await this.saveItem(data);
    }
  }

  /**
   * 1 and 2 both record downloads; 2 ("show in work only") once also hid a Downloads page that no longer exists.
   */
  downloadHistoryDisabled() {
    return this.application.settings.enableSaveDownloadHistory === 0;
  }

  async itemDownload(data) {
    if (data.downloaded_at && !this.downloadHistoryDisabled()) {
      await this.saveItem(data);
    }
  }

  deleteItem(data) {
    if (data.uid) {
      return this.history.deleteItem(data.uid);
    }
  }

  /**
   * Imports entries from an export file or the history backup, in either the
   * current or the v5 shape. NSFW entries are kept even with
   * notSaveNSFWWorkInHistory on: that setting is about recording visits, and
   * an import is the user's own choice.
   *
   * @param {{ items: Array }} param0
   * @returns {Promise<{ imported: number, skipped: number }>}
   */
  async importItems({ items }) {
    let list = Array.isArray(items) ? items : [];
    let valid = list.map(toHistoryItem).filter(Boolean);

    if (valid.length > 0) {
      this.applyMaxHistoryItems();
      await this.history.importItems(valid);
    }

    return { imported: valid.length, skipped: list.length - valid.length };
  }

  async clear() {
    await this.history.clear();

    return true;
  }

  async checkIfDownloaded({ uid }) {
    if (this.downloadHistoryDisabled()) {
      return 0;
    }

    let historyRepo = Db.getDb().historyRepo();
    let item = await historyRepo.getItem({ uid });

    if (item && item.downloaded_at) {
      return item.downloaded_at;
    } else {
      return 0;
    }
  }
}

export default HistoryService;
