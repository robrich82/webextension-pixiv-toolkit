import { app } from "../Application";
import migrateIllustHistory from "../modules/migrateIllustHistory";
import migrateHistoryBackup from "../modules/migrateHistoryBackup";

const OLD_MANGA_RENAME_RULE = '{id}_{title}}';

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
 * the PouchDB store and the `historyBackup` setting (see migrateIllustHistory
 * and migrateHistoryBackup). On an install that never had v5 history both
 * are empty, so they import nothing.
 *
 * Also repairs `mangaRenameRule` where it still holds the old default
 * `{id}_{title}}`, whose stray `}` ended every manga name. A rule the user
 * set is left alone.
 */
export default async () => {
  const settingService = app().getService('setting');

  await settingService.removeSettings(['ugoiraConvertTool', 'maxDownloadRecords']);

  const { mangaRenameRule } = await settingService.getSetting('mangaRenameRule');

  if (mangaRenameRule === OLD_MANGA_RENAME_RULE) {
    await settingService.updateSettings({ mangaRenameRule: '{id}_{title}' });
  }

  await migrateIllustHistory(app().getService('history'));
  await migrateHistoryBackup(app().getService('setting'), app().getService('history'));

  console.log(`update patched, target: 6.4.7`);
}
