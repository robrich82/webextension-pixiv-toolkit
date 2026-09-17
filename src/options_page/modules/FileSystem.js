const { default: browser } = require("@/modules/Extension/browser");

/**
 * @typedef SaveFileOptions
 * @property {string} url
 * @property {string} filename
 */
class FileSystem {
  /**
   * @type {FileSystem}
   */
  static instance;

  /**
   * @returns {FileSystem}
   */
  static getDefault() {
    if (!FileSystem.instance) {
      FileSystem.instance = new FileSystem();
    }

    return FileSystem.instance;
  }

  /**
   * Save file
   * @param {SaveFileOptions} options
   */
  saveFile(options) {
    return new Promise((resolve, reject) => {
      browser.downloads.download({
        url: options.url,
        filename: options.filename,
      }, downloadId => {
        /**
         * On failure (invalid/blocked filename, revoked permission, an
         * already-revoked blob: URL, ...) the callback fires with
         * downloadId === undefined and sets runtime.lastError. Left
         * unchecked, that silently resolves as if the file had saved.
         */
        const lastError = browser.runtime.lastError;

        if (lastError || downloadId === undefined) {
          reject(new Error(`Failed to download "${options.filename}": ${lastError ? lastError.message : 'no download id returned'}`));
          return;
        }

        resolve(downloadId);
      });
    });
  }

  /**
   * Save file in background
   * @param {SaveFileOptions} options
   */
  async saveFileInBackground(options) {
    return await browser.runtime.sendMessage({
      to: 'ws',
      action: 'download:saveFile',
      args: {
        url: options.url,
        filename: options.filename
      }
    });
  }
}

export default FileSystem;
