import versionCompare from "@/modules/Util/versionCompare";

class Updater {
  /**
   * @type {string}
   */
  currentVersion;

  /**
   * @type {string}
   */
  previousVersion;

  /**
   * @type {Map<string,Function>}
   */
  updates;

  /**
   *
   * @param {string} currentVersion
   * @param {string} previousVersion
   * @param {Map<string,Function>} updates
   */
  constructor(currentVersion, previousVersion, updates) {
    this.currentVersion = currentVersion;
    this.previousVersion = previousVersion;
    this.updates = updates;
  }

  /**
   * Run every update the previous version hasn't seen yet, in the order the
   * map was built. Sequentially and awaited: the updates share settings
   * storage, so a later one must see what an earlier one wrote, and the
   * caller stamps the new version once this resolves.
   */
  async update() {
    for (let [version, update] of this.updates) {
      if (versionCompare(this.previousVersion, version) < 0) {
        await update();
      }
    }
  }
}

export default Updater;
