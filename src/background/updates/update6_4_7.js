import { app } from "../Application";
import migrateIllustHistory from "../modules/migrateIllustHistory";

/**
 * Update to 6.4.7
 *
 * Drops two inert settings. No live code reads either key, so removing
 * them only clears a stale value; there is no behaviour to preserve.
 * - `ugoiraConvertTool` picked between conversion tools before ffmpeg-core
 *   was bundled locally.
 * - `maxDownloadRecords` capped the download-record store, which upstream
 *   stopped using in 6.0.0.
 *
 * Also moves the v5 visit history from PouchDB into the History page's Dexie
 * table (see migrateIllustHistory). On an install that never had v5 history
 * the PouchDB store is empty, so that step imports nothing.
 */
export default async () => {
  await app().getService('setting').removeSettings(['ugoiraConvertTool', 'maxDownloadRecords']);
  await migrateIllustHistory(app().getService('history'));

  console.log(`update patched, target: 6.4.7`);
}
