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
   * Revoke a blob url once the download reading it is done with it. A save
   * answers as soon as the download exists, and Firefox fails a download
   * whose blob url is revoked before it has read the bytes (#296).
   *
   * Done means complete, erased, gone, or interrupted and not paused. Firefox
   * pauses by cancelling, so a paused download there reports `interrupted`
   * and still needs the url to resume.
   * @param {number|undefined} downloadId The save's answer; without one, revokes at once
   * @param {string} url
   * @returns {Promise<void>} Settles once the url is revoked; never rejects
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
        browser.downloads.onErased.removeListener(onErased);
        URL.revokeObjectURL(url);
        resolve();
      };

      const check = () => browser.downloads.search({ id: downloadId }).then(([item] = []) => {
        if (!item || item.state === 'complete' || (item.state === 'interrupted' && !item.paused)) {
          revoke();
        }
      }, error => {
        // Revoking on a guess would bring #296 back; wait for the next change.
        console.warn(`Couldn't look up download ${downloadId}, keeping its url for now`, error);
      });

      const onChanged = delta => {
        if (delta.id === downloadId && (delta.state || delta.paused)) {
          check();
        }
      };

      const onErased = id => {
        if (id === downloadId) {
          revoke();
        }
      };

      browser.downloads.onChanged.addListener(onChanged);
      browser.downloads.onErased.addListener(onErased);

      // It may have finished before the listeners were added.
      check();
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
