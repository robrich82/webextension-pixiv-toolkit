/**
 * Plays the background's side of `Downloader`'s `DownloadFile` ports, speaking
 * the protocol of `src/background/services/DownloadFileService.js`. Each request
 * waits until the spec answers it, so a spec decides when, and how, a file ends.
 * It also answers `download:saveFile` (see answerSaves()); a spec whose own
 * listener answers some saves must exclude them with leaveSaves().
 */
import browser from '../doubles/browser';

/**
 * Answers `download:saveFile` as the background does: it starts a download and
 * answers with its id, or answers nothing for a save it couldn't make. Set `fail`
 * to pick which saves fail. A download stays `in_progress` until the spec ends it
 * with `browser._fake.finishDownload(id)`.
 */
export function answerSaves() {
  const answerer = {
    /** The args of every save asked for, in order, with the `downloadId` it got. */
    saves: [],
    /** @type {(save: { url: string, filename: string }) => boolean} */
    fail: () => false,
    /** Saves left for another listener to answer. */
    leave: () => false
  };
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.to === 'ws' && message.action === 'download:saveFile' && !answerer.leave(message.args)) {
      const save = { ...message.args };
      answerer.saves.push(save);

      if (answerer.fail(message.args)) {
        sendResponse(undefined);
      } else {
        browser.downloads.download(message.args).then(downloadId => {
          save.downloadId = downloadId;
          sendResponse(downloadId);
        });
      }

      return true;
    }
  });

  return answerer;
}

export function fakeDownloadFileBackground() {
  const requests = [];
  const aborted = [];
  const saveAnswerer = answerSaves();

  browser.runtime.onConnect.addListener(port => {
    if (port.name !== 'DownloadFile') {
      return;
    }

    port.onMessage.addListener(message => {
      if (message.action === 'download') {
        requests.push({
          url: message.url,
          options: message.options,
          port,
          complete(body = 'file', mimeType = 'image/png') {
            const data = `data:${mimeType};base64,${Buffer.from(body).toString('base64')}`;
            port.postMessage({ event: 'complete', data: { data, mimeType } });
          },
          fail(error = 'network error') {
            port.postMessage({ event: 'error', data: { error } });
          }
        });
      } else if (message.action === 'abort') {
        aborted.push(requests.find(request => request.port === port)?.url);
        port.postMessage({ event: 'abort' });
      }
    });
  });

  return {
    requests,
    /** The latest request for `url`. */
    request(url) {
      return requests.filter(request => request.url === url).pop();
    },
    /** The url of each request the page aborted, in order. */
    aborted,
    saves: saveAnswerer.saves,
    /** Pick which saves the background can't make. */
    failSaves(predicate) {
      saveAnswerer.fail = predicate;
    },
    /** Leave some saves for the spec's own listener to answer. */
    leaveSaves(predicate) {
      saveAnswerer.leave = predicate;
    }
  };
}
