/**
 * Removes the v5 `historyBackup` setting. Its entries are imported into the
 * History page first, but only when the v5 PouchDB store gave nothing: v5 kept
 * the backup in case that store was lost. When the store was there, the backup
 * holds little else but entries the user deleted, because v5's single-entry
 * delete never reached it.
 *
 * If the import fails, the key is kept. Nothing reads it any more, so that
 * only leaves the entries in the settings export for recovery by hand.
 *
 * @param {import('../services/SettingService').default} settingService
 * @param {import('../services/HistoryService').default} historyService
 * @param {{ imported: number }|null} illustHistory what migrateIllustHistory returned
 */
export default async function migrateHistoryBackup(settingService, historyService, illustHistory) {
  const { historyBackup } = await settingService.getSetting('historyBackup');

  if (historyBackup === undefined) {
    return;
  }

  if (!illustHistory || illustHistory.imported === 0) {
    let result;

    try {
      result = await historyService.importItems({ items: historyBackup });
    } catch (error) {
      console.error('Unable to move the v5 history backup into the History page; the setting was kept', error);

      return;
    }

    console.info('Moved the v5 history backup into the History page', result);
  }

  await settingService.removeSettings(['historyBackup']);
}
