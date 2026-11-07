import Dexie from 'dexie';
import AbstractRepo from './AbstractRepo';

/**
 * One entry from two records of the same work: the later visit's details
 * where it has them, and the later of each timestamp. Keeps the stored
 * record's `id`.
 */
function mergeEntries(a, b) {
  let [older, newer] = (b.visited_at || 0) >= (a.visited_at || 0) ? [a, b] : [b, a];
  let merged = Object.assign({}, older, { id: a.id ?? b.id });

  Object.keys(newer).forEach(key => {
    if (newer[key] !== undefined && newer[key] !== '') {
      merged[key] = newer[key];
    }
  });
  let downloaded_at = Math.max(a.downloaded_at || 0, b.downloaded_at || 0);

  merged.visited_at = Math.max(a.visited_at || 0, b.visited_at || 0);

  if (merged.id === undefined) {
    delete merged.id;
  }

  if (downloaded_at) {
    merged.downloaded_at = downloaded_at;
  } else {
    delete merged.downloaded_at;
  }

  return merged;
}

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
   * Every entry, newest visit first, without the database id, in the shape
   * importItems reads back.
   *
   * @returns {Promise<ItemType[]>}
   */
  async exportItems() {
    return (await this.byLatestVisit().toArray()).map(({ id, ...item }) => item);
  }

  /**
   * Writes already-converted entries in one transaction. An entry whose work
   * is already stored, or that appears twice, is merged rather than
   * duplicated (`uid` is unique). Trims to the cap afterwards.
   *
   * @param {ItemType[]} items
   */
  async importItems(items) {
    let byUid = new Map();

    items.forEach(item => {
      let seen = byUid.get(item.uid);
      byUid.set(item.uid, seen ? mergeEntries(seen, item) : item);
    });

    await this.table.db.transaction('rw', this.table, async () => {
      let stored = await this.table.where('uid').anyOf([...byUid.keys()]).toArray();

      stored.forEach(entry => byUid.set(entry.uid, mergeEntries(entry, byUid.get(entry.uid))));

      await this.table.bulkPut([...byUid.values()]);
    });

    await this.trim();
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
