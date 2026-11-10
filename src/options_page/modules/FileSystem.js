import browser from "@/modules/Extension/browser";

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
   * Revoke a blob url once the download reading it has finished. A save
   * answers as soon as the download exists, and Firefox fails a download
   * whose blob url is revoked before it has read the bytes (#296).
   * @param {number|undefined} downloadId The save's answer; without one, revokes at once
   * @param {string} url
   * @returns {Promise<void>} Settles once the url is revoked
   */
  revokeWhenSaved(downloadId, url) {
    if (downloadId === undefined || downloadId === null) {
      URL.revokeObjectURL(url);
      return Promise.resolve();
    }

    return new Promise(resolve => {
      let revoked = false;

      const revoke = () => {
        if (revoked) {
          return;
        }

        revoked = true;
        browser.downloads.onChanged.removeListener(onChanged);
        URL.revokeObjectURL(url);
        resolve();
      };

      const onChanged = ({ id, state }) => {
        if (id === downloadId && state && state.current !== 'in_progress') {
          revoke();
        }
      };

      browser.downloads.onChanged.addListener(onChanged);

      // It may have finished before the listener was added.
      browser.downloads.search({ id: downloadId }).then(([item] = []) => {
        if (!item || item.state !== 'in_progress') {
          revoke();
        }
      }, revoke);
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
