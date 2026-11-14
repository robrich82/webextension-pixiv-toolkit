import AbstractService from "./AbstractService";
import Db from "@/modules/Db/Db";

/**
 * @class
 */
class LogService extends AbstractService {
  /**
   * @type {LogService}
   */
  static instance;

  /**
   *
   * @returns {LogService}
   */
  static getService() {
    if (!LogService.instance) {
      LogService.instance = new LogService();
    }

    return LogService.instance;
  }

  /**
   * The errors the background recorded, oldest first, one line each.
   * @returns {Promise<string[]>}
   */
  async getTrackedErrors() {
    const items = await Db.getDb().trackedErrorRepo().getItems();

    return items.map(({ error, created_at }) => {
      const message = error && error.message !== undefined ? `${error.name}: ${error.message}` : String(error);

      return `${new Date(created_at).toISOString()} ${message}`;
    });
  }
}

export default LogService;
