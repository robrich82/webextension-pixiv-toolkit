import { app } from "../Application";

/**
 * Update to 6.4.7
 *
 * Drops two inert settings. No live code reads either key, so removing
 * them only clears a stale value; there is no behaviour to preserve.
 * - `ugoiraConvertTool` picked between conversion tools before ffmpeg-core
 *   was bundled locally.
 * - `maxDownloadRecords` capped the download-record store, which upstream
 *   stopped using in 6.0.0.
 */
export default async () => {
  await app().getService('setting').removeSettings(['ugoiraConvertTool', 'maxDownloadRecords']);

  console.log(`update patched, target: 6.4.7`);
}
