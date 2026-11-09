import Dexie from 'dexie';

class AbstractRepo {
  /**
   * @type {number}
   */
  max;

  /**
   * @type {Dexie.Table}
   */
  table;

  constructor(table, { max }) {
    this.table = table;
    this.max = max;
  }

  /**
   *
   * @param {number} max
   */
  setMax(max) {
    this.max = max;
  }

  /**
   * @param {Object} data
   */
  async addItem(data) {
    // One transaction, so a failed add keeps the rows it trimmed and
    // concurrent adds can't overshoot the cap.
    await this.table.db.transaction('rw', this.table, async () => {
      const count = await this.table.count();

      // Make room first, so the table holds at most max entries after the add.
      if (count >= this.max) {
        await this.table.limit(count - this.max + 1).delete();
      }

      await this.table.add(data);
    });
  }

  /**
   * @param {Object} equals
   */
  async getItem(equals) {
    return await this.table.get(equals);
  }

  /**
   * @param {string} id
   */
  deleteItem(id) {
    return this.table.where('id').equals(id).delete();
  }

  clear() {
    return this.table.clear();
  }
}

export default AbstractRepo;
