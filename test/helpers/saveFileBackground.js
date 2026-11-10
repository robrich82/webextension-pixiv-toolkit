/**
 * Answers the download manager's `download:saveFile` as the background does:
 * each save starts a download and answers with its id. The download stays
 * `in_progress` until the spec ends it with `browser._fake.finishDownload(id)`.
 */
import browser from '../doubles/browser';

/**
 * @returns {{ url: string, filename: string, downloadId: number }[]} Filled in as saves arrive
 */
export function answerSaves() {
  const saves = [];

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.to === 'ws' && message.action === 'download:saveFile') {
      browser.downloads.download(message.args).then(downloadId => {
        saves.push({ ...message.args, downloadId });
        sendResponse(downloadId);
      });

      return true;
    }
  });

  return saves;
}
