/**
 * Imports the v5 `historyBackup` setting into the History page, then removes
 * it, as the Recover button it replaces would have. In the fork the setting
 * only comes from importing an upstream settings export.
 *
 * If the import fails, the key is kept. Nothing reads it any more, so that
 * only leaves the entries in the settings export for recovery by hand.
 *
 * @param {import('../services/SettingService').default} settingService
 * @param {import('../services/HistoryService').default} historyService
 */
export default async function migrateHistoryBackup(settingService, historyService) {
  const { historyBackup } = await settingService.getSetting('historyBackup');

  if (historyBackup === undefined) {
    return;
  }

  let result;

  try {
    result = await historyService.importItems({ items: historyBackup });
  } catch (error) {
    console.error('Unable to move the v5 history backup into the History page; the setting was kept', error);

    return;
  }

  console.info('Moved the v5 history backup into the History page', result);

  await settingService.removeSettings(['historyBackup']);
}
