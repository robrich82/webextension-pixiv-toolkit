import Dexie from 'dexie';
import AbstractRepo from './AbstractRepo';

/**
 * @typedef ItemType
 * @property {string} uid
 * @property {string} title
 * @property {string} cover
 * @property {string} url
 * @property {string} type
 * @property {string} r
 * @property {number} visited_at
 * @property {number} downloaded_at
 */
class HistoryRepo extends AbstractRepo {
  /**
   * @type {HistoryRepo}
   */
  static instance;

  /**
   *
   * @param {Dexie.Table} table
   * @param {{ max: number }} param1
   */
  constructor(table, { max } = { max: 10000 }) {
    super(table, { max });
  }

  /**
   *
   * @param {Dexie.Table} table
   * @returns {HistoryRepo}
   */
  static getDefault(table) {
    if (!HistoryRepo.instance) {
      HistoryRepo.instance = new HistoryRepo(table);
    }

    return HistoryRepo.instance;
  }

  /**
   * Newest visit first. Insertion order would list a revisited or imported
   * entry by when it was stored, not when it was visited.
   *
   * @returns {Dexie.Collection}
   */
  byLatestVisit() {
    return this.table.orderBy('visited_at').reverse();
  }

  /**
   * @param {Dexie.Collection} collection
   * @param {number} page
   * @param {number} count
   */
  async paginate(collection, page, count) {
    let offset = (page - 1) * count;

    if (offset > 0) {
      collection = collection.offset(offset);
    }

    return await collection.limit(count).toArray();
  }

  async getItems({ page, count = 20 }) {
    return await this.paginate(this.byLatestVisit(), page, count);
  }

  async searchItems({ query, page, count = 20 }) {
    let collection = this.byLatestVisit().filter(item => {
      return item.title.indexOf(query) > -1 || (item.userName && item.userName.indexOf(query) > -1);
    });

    return await this.paginate(collection, page, count);
  }

  /**
   * Adds, then drops the least recently visited entries over the cap.
   *
   * @param {Object} data
   */
  async addItem(data) {
    await this.table.add(data);
    await this.trim();
  }

  /**
   * Deletes everything after the newest `max` rather than counting an excess,
   * so two trims racing each other can't both delete the same overflow.
   */
  async trim() {
    await this.byLatestVisit().offset(this.max).delete();
  }

  /**
   * @inheritdoc
   * @param {ItemType} item
   */
  async saveItem(item) {
    let data = {
      uid: item.uid,
      title: item.title,
      url: item.url,
      cover: item.cover,
      userName: item.userName,
      type: item.type,
      r: item.r,
    };

    if (item.visited_at) {
      data.visited_at = item.visited_at;
    }

    if (item.downloaded_at) {
      data.downloaded_at = item.downloaded_at;
    }

    let foundItem = await this.getItem({ uid: item.uid });

    if (!foundItem) {
      if (data.downloaded_at) {
        data.visited_at = data.downloaded_at;
      }

      await this.addItem(data);
    } else {
      await this.table.update(foundItem.id, data);
    }
  }
}

export default HistoryRepo;
