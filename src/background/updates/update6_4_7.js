import { app } from "../Application";
import migrateIllustHistory from "../modules/migrateIllustHistory";

/**
 * Imports the v5 `historyBackup` setting into the History page, then removes
 * it. This replaces the Recover button, which was the only thing that read
 * it. If the import fails the key is kept, so the entries aren't lost.
 */
async function migrateHistoryBackup() {
  const setting = app().getService('setting');
  const { historyBackup } = await setting.getSetting('historyBackup');

  if (historyBackup === undefined) {
    return;
  }

  try {
    const result = await app().getService('history').importItems({ items: historyBackup });

    console.info('Moved the v5 history backup into the History page', result);
  } catch (error) {
    console.error('Unable to move the v5 history backup into the History page; the setting was kept', error);

    return;
  }

  await setting.removeSettings(['historyBackup']);
}

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
 * Also moves the v5 visit history from PouchDB and from the `historyBackup`
 * setting into the History page's Dexie table (see migrateIllustHistory). On
 * an install that never had v5 history both are empty, so they import nothing.
 */
export default async () => {
  await app().getService('setting').removeSettings(['ugoiraConvertTool', 'maxDownloadRecords']);
  await migrateIllustHistory(app().getService('history'));
  await migrateHistoryBackup();

  console.log(`update patched, target: 6.4.7`);
}
