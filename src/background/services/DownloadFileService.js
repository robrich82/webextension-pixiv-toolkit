/*
 * @Author: Leo Ding <leoding86@msn.com>
 * @Date: 2024-08-12 12:45:02
 * @LastEditors: Leo Ding <leoding86@msn.com>
 * @LastEditTime: 2024-08-12 19:06:00
 * @FilePath: \webextension-pixiv-toolkit\src\background\services\DownloadFileService.js
 */
/*
 * @Author: Leo Ding <leoding86@msn.com>
 * @Date: 2024-08-12 12:45:02
 * @LastEditors: Leo Ding <leoding86@msn.com>
 * @LastEditTime: 2024-08-12 13:34:26
 * @FilePath: \webextension-pixiv-toolkit\src\background\services\DownloadFileService.js
 */
import AbstractPortService from "./AbstractPortService";
import Download from "@/modules/Net/Download";

class DownloadFileService extends AbstractPortService {
  static instance;

  /**
   * The download running for each port, until it ends or the port closes.
   * @type {Map<any, Download>}
   */
  portDownloadMap = new Map();

  static getServce() {
    if (!DownloadFileService.instance) {
      DownloadFileService.instance = new DownloadFileService();
    }

    return DownloadFileService.instance;
  }

  /**
   * Post to the port while its download runs. Once the port has closed, posting would throw.
   */
  postMessage(port, event, data) {
    if (!this.portDownloadMap.has(port)) {
      return;
    }

    port.postMessage({
      event,
      data
    });
  }

  /**
   * Post the download's last message and forget it.
   */
  endDownload(port, event, data) {
    this.postMessage(port, event, data);
    this.portDownloadMap.delete(port);
  }

  /**
   * The download manager page closed, or dropped the file: stop fetching it.
   */
  onDisconnect(port) {
    const download = this.portDownloadMap.get(port);

    if (download) {
      this.portDownloadMap.delete(port);
      download.abort();
    }
  }

  onMessage(args) {
    const port = args.port;

    if (args.action === 'download' && typeof args.url === 'string') {
      const download = new Download(args.url, args.options || void 0);

      this.portDownloadMap.set(port, download);

      download.addListener('onprogress', progress => {
        this.postMessage(port, 'progress', { progress });
      });
      download.addListener('onerror', error => {
        this.endDownload(port, 'error', { error: error.message });
      });
      download.addListener('onfinish', (data, mimeType) => {
        const reader = new FileReader();
        reader.onload = () => {
          this.endDownload(port, 'complete', { data: reader.result, mimeType });
        };
        reader.readAsDataURL(data);
      });
      download.addListener('onabort', () => {
        this.endDownload(port, 'abort');
      });

      download.download();
    } else if (args.action === 'abort') {
      const download = this.portDownloadMap.get(port);

      if (download) {
        download.abort();
      }
    }
  }
}

export default DownloadFileService;
