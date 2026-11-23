import { app } from "../Application";
import migrateIllustHistory from "../modules/migrateIllustHistory";
import migrateHistoryBackup from "../modules/migrateHistoryBackup";
import repairMangaRenameRule from "@/config/repairMangaRenameRule";

/**
 * Update to 6.4.7
 *
 * Drops settings nothing reads any more, so removing them only clears a
 * stale value.
 * - `ugoiraConvertTool` picked between conversion tools before ffmpeg-core
 *   was bundled locally.
 * - `maxDownloadRecords` capped the download-record store, which upstream
 *   stopped using in 6.0.0.
 * - `ugoiraCustomFFmpegCommand` was the Custom ugoira download's FFmpeg
 *   command, removed with that download.
 * - The four `ugoiraFFmpeg*CliArgs` held each format's FFmpeg command. They
 *   came in 6.2.0, whose download adapter already used its own copies.
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

  await settingService.removeSettings([
    'ugoiraConvertTool', 'maxDownloadRecords', 'ugoiraCustomFFmpegCommand',
    'ugoiraFFmpegGIFCliArgs', 'ugoiraFFmpegAPNGCliArgs', 'ugoiraFFmpegWEBMCliArgs', 'ugoiraFFmpegMP4CliArgs'
  ]);

  const { mangaRenameRule } = await settingService.getSetting('mangaRenameRule');

  const repairedRule = repairMangaRenameRule(mangaRenameRule);

  if (repairedRule !== mangaRenameRule) {
    await settingService.updateSettings({ mangaRenameRule: repairedRule });
  }

  await migrateIllustHistory(app().getService('history'));
  await migrateHistoryBackup(app().getService('setting'), app().getService('history'));

  console.log(`update patched, target: 6.4.7`);
}
