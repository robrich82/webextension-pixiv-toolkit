import Download from '@/modules/Net/Download';
import Event from '@/modules/Event';
import browser from '../Extension/browser';

/**
 * @class
 */
class Downloader extends Event {
  /**
   * The files whichs need to be downloaded
   * @type {{file: string, seq: number|string, args: Object}[]}
   */
  files = [];

  /**
   * The queue of files still to download: a copy of `files` after `reset()`, consumed by `downloadNext()`
   * @type {{file: string, seq: number|string, args: Object}[]}
   */
  downloadFiles = [];

  /**
   * The files can't be downloaded.
   * @type {{file: string, seq: number|string, args: Object}[]}
   */
  failedDownloadFiles = [];

  /**
   * @type {Download[]}
   */
  downloadFilePorts = [];

  /**
   * Ports the background has answered on (complete, error or abort), or that closed: nothing left to abort.
   * @type {WeakSet<Download>}
   */
  endedFilePorts = new WeakSet();

  /**
   * @type {number}
   */
  counter = 0;

  /**
   * @type {boolean}
   */
  paused = false;

  /**
   * @constructor
   * @param {Object} arguments
   * @param {Number} [arguments.processors=1]
   * @param {Object} [requestOptions={}]
   * @param {CallableFunction} [beforeItemDownload]
   */
  constructor({
    processors = 1,
    requestOptions = {},
    beforeItemDownload = undefined,
    afterItemDownload = undefined
  }) {
    super();
    // Below 1 (or not a number), nothing would ever start.
    this.processors = Math.max(1, Math.floor(Number(processors)) || 1);
    this.requestOptions = requestOptions;
    this.beforeItemDownload = beforeItemDownload;
    this.afterItemDownload = afterItemDownload;
    this.successCount = 0;
    this.progresses = [];
    this.asBlob = true;
  }

  /**
   * @override
   * @param {'start'|'progress'|'item-finish'|'finish'|'failure'|'item-error'|'pause'|'abort'} eventName
   */
  dispatch(eventName, args) {
    super.dispatch(eventName, args);
  }

  removeDownloadFromCollection(downloadFilePort) {
    const index = this.downloadFilePorts.indexOf(downloadFilePort);

    if (index > -1) {
      this.downloadFilePorts.splice(index, 1);
    }
  }

  dispatchProgress() {
    this.dispatch('progress', [{
      progress: this.progresses.reduce((previousValue, currentValue) => previousValue + currentValue, 0) / this.files.length,
      successCount: this.successCount,
      failCount: this.failedDownloadFiles.length
    }]);
  }

  finishFile(itemFinishData) {
    this.successCount++;
    this.dispatchProgress();
    this.dispatch('item-finish', [itemFinishData]);
    this.downloadNext();
  }

  /**
   * Set a file aside for the next `download()` to retry, and move on.
   */
  failFile(downloadFile, error) {
    this.failedDownloadFiles.push(downloadFile);
    this.progresses[downloadFile.seq] = 0;

    console.error(`Could not download ${downloadFile.file}`, error);

    this.dispatch('item-error', [error]);
    this.dispatchProgress();
    this.downloadNext();
  }

  /**
   * @deprecated
   * Initialize downloader, should call it after `appendFile`
   */
  initial() {
    console.warn('This method will be deprecated later');
  }

  /**
   * @override
   * @param {'start'|'progress'|'item-finish'|'finish'|'failure'|'item-error'|'pause'|'abort'} eventName
   * @param {Function} listener
   * @param {*} thisArg
   */
  addListener(eventName, listener, thisArg) {
    super.addListener(eventName, listener, thisArg);
  }

  pause() {
    this.paused = true;

    // A port in afterItemDownload may already be closed, and posting to it throws.
    this.downloadFilePorts
      .filter(downloadFilePort => !this.endedFilePorts.has(downloadFilePort))
      .forEach(downloadFilePort => downloadFilePort.postMessage({ action: 'abort' }));
  }

  reset() {
    this.progresses = [];
    this.downloadFiles = this.files.slice();
    this.failedDownloadFiles = [];
    this.successCount = 0;
  }

  download() {
    this.paused = false;

    if (this.failedDownloadFiles.length > 0) {
      this.downloadFiles = this.downloadFiles.concat(this.failedDownloadFiles);
      this.failedDownloadFiles = [];
    }

    this.downloadNext();
  }

  downloadNext() {
    if (this.paused) {
      return;
    }

    if (this.downloadFiles.length > 0) {
      while (this.downloadFiles.length > 0 && this.downloadFilePorts.length < this.processors) {
        this.downloadFile(this.downloadFiles.shift());
      }
    } else if (this.downloadFilePorts.length === 0) {
      // Nothing queued or in flight. Failed files wait for download() to retry them.
      this.dispatch(this.failedDownloadFiles.length > 0 ? 'failure' : 'finish');
    }
  }

  downloadFile(downloadFile) {
    let requestOptions = Object.assign({ method: 'GET' }, this.requestOptions);

    if (this.beforeItemDownload && typeof this.beforeItemDownload === 'function') {
      this.beforeItemDownload.call(this, {
        requestOptions,
        downloadFile
      });
    }

    const downloadFilePort = browser.runtime.connect({
      name: 'DownloadFile',
    });

    // Firefox closes ports when its event page idles, and a closed port sends nothing.
    downloadFilePort.onDisconnect.addListener(() => {
      if (!this.endedFilePorts.has(downloadFilePort)) {
        this.endedFilePorts.add(downloadFilePort);
        this.removeDownloadFromCollection(downloadFilePort);
        this.failFile(downloadFile, new Error('The background closed the download'));
      }
    });

    downloadFilePort.onMessage.addListener(message => {
      if (message.event !== 'progress') {
        this.endedFilePorts.add(downloadFilePort);
      }

      if (message.event === 'progress') {
        const { totalLength, loadedLength } = message.data.progress;
        // totalLength is 0 when the response has no Content-Length
        this.progresses[downloadFile.seq] = totalLength > 0 ? Math.min(loadedLength / totalLength, 1) : 0;

        this.dispatchProgress();
      } else if (message.event === 'error') {
        this.removeDownloadFromCollection(downloadFilePort);
        this.failFile(downloadFile, new Error(message.data.error));
      } else if (message.event === 'complete') {
        const { data, mimeType } = message.data;

        this.progresses[downloadFile.seq] = 1;

        // The port counts as in flight until afterItemDownload settles, so the run can't end around it.
        fetch(data)
          .then(response => response.blob())
          .then(blob => {
            const itemFinishData = {
              blob: this.asBlob ? blob : null,
              data: this.asBlob ? null : blob,
              args: downloadFile.args,
              downloadFilePort,
              mimeType
            };

            if (typeof this.afterItemDownload !== 'function') {
              return itemFinishData;
            }

            return Promise.resolve(this.afterItemDownload.call(this, { itemFinishData, downloadFile }))
              .then(() => itemFinishData);
          })
          .then(itemFinishData => {
            this.removeDownloadFromCollection(downloadFilePort);
            this.finishFile(itemFinishData);
          }, error => {
            this.removeDownloadFromCollection(downloadFilePort);
            this.failFile(downloadFile, error);
          });
      } else if (message.event === 'abort') {
        this.removeDownloadFromCollection(downloadFilePort);
        this.progresses[downloadFile.seq] = 0;

        // Put the file back in the queue.
        this.downloadFiles.unshift(downloadFile);

        if (!this.paused) {
          // download() was called again before this abort came back.
          this.downloadNext();
        } else if (this.downloadFilePorts.length === 0) {
          this.dispatch('pause');
        }
      }
    });

    // let download = new Download(downloadFile.file, requestOptions);
    // download.asBlob = this.asBlob;

    /**
     * Listen download onprogress event
     */
    // download.addListener('onprogress', ({totalLength, loadedLength}) => {
    //   this.progresses[downloadFile.seq] = loadedLength / totalLength;

    //   this.dispatch('progress', [{
    //     progress: this.progresses.reduce((previousValue, currentValue) => previousValue + currentValue) / this.files.length,
    //     successCount: this.successCount,
    //     failCount: this.failedDownloadFiles.length
    //   }]);
    // });

    /**
     * Listen download onfinish event
     */
    // download.addListener('onfinish', (data, mimeType) => {
    //   this.removeDownloadFromCollection(download);

    //   const itemFinishData = {
    //     blob: this.asBlob ? data : null,
    //     data: this.asBlob ? null : data,
    //     args: downloadFile.args,
    //     download,
    //     mimeType
    //   };

    //   if (this.afterItemDownload && typeof this.afterItemDownload === 'function') {
    //     const afterItemDownloadResult = this.afterItemDownload.call(this, {
    //       itemFinishData,
    //       downloadFile
    //     });

    //     if (afterItemDownloadResult instanceof Promise) {
    //       afterItemDownloadResult.then(() => {
    //         this.successCount++;
    //         this.dispatch('item-finish', [itemFinishData]);
    //         this.downloadNext();
    //       }).catch((error) => {
    //         this.dispatch('item-error', [error]);
    //       });

    //       return;
    //     }
    //   }

    //   this.successCount++;
    //   this.dispatch('item-finish', [itemFinishData]);
    //   this.downloadNext();
    // });

    /**
     * Listen download onabort event
     */
    // download.addListener('onabort', () => {
    //   this.removeDownloadFromCollection(download);

    //   this.progresses[downloadFile.seq] = 0;

    //   /**
    //    * Put the downloadFile back to the downloadFiles for re-tracking it
    //    */
    //   this.downloadFiles.unshift(downloadFile);

    //   if (this.downloads.length === 0) {
    //     this.dispatch('pause');
    //   }
    // });

    /**
     * Listen download onerror event
     */
    // download.addListener('onerror', error => {
    //   this.removeDownloadFromCollection(download);

    //   this.failedDownloadFiles.push(downloadFile);
    //   this.progresses[downloadFile.seq] = 0;

    //   console.error(error);

    //   this.dispatch('item-error', [error]);
    //   this.dispatch('progress', [{
    //     progress: this.progresses.reduce((previousValue, currentValue) => previousValue + currentValue) / this.files.length,
    //     successCount: this.successCount,
    //     failCount: this.failedDownloadFiles.length,
    //   }]);

    //   this.downloadNext();
    // });

    /**
     * Start the download and put the instance to download collection for increasing
     * download processes
     */
    this.downloadFilePorts.push(downloadFilePort);
    // download.download();
    downloadFilePort.postMessage({
      action: 'download',
      url: downloadFile.file,
      options: requestOptions
    });

    /**
     * Fire the download start event
     */
    this.dispatch('start');
  }

  /**
   * Download files
   * @param {string} file
   * @param {any} args This param will pass to event handle when file is downloaded
   */
  appendFile(file, args) {
    let seq = this.counter;
    this.counter++;

    let downloadData = {
      file, seq, args
    };

    this.files.push(downloadData);

    this.downloadFiles.push(downloadData);
  }
}

export default Downloader;
