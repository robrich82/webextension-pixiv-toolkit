/**
 * Plays the background's side of `Downloader`'s `DownloadFile` ports, speaking
 * the protocol of `src/background/services/DownloadFileService.js`. Each request
 * waits until the spec answers it, so a spec decides when, and how, a file ends.
 */
import browser from '../doubles/browser';

export function fakeDownloadFileBackground() {
  const requests = [];
  const aborted = [];

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
    aborted
  };
}
