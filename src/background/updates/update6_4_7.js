import { app } from "../Application";
import migrateIllustHistory from "../modules/migrateIllustHistory";
import migrateHistoryBackup from "../modules/migrateHistoryBackup";

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
 * Also moves the v5 visit history into the History page's Dexie table, from
 * the PouchDB store and then, as a fallback, from the `historyBackup` setting
 * (see migrateIllustHistory and migrateHistoryBackup). On an install that
 * never had v5 history both are empty, so they import nothing.
 */
export default async () => {
  await app().getService('setting').removeSettings(['ugoiraConvertTool', 'maxDownloadRecords']);

  const history = app().getService('history');
  const illustHistory = await migrateIllustHistory(history);

  await migrateHistoryBackup(app().getService('setting'), history, illustHistory);

  console.log(`update patched, target: 6.4.7`);
}
