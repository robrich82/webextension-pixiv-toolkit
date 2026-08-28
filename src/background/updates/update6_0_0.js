/*
 * @Author: Leo Ding <leoding86@msn.com>
 * @Date: 2024-08-21 13:26:02
 * @LastEditors: Leo Ding <leoding86@msn.com>
 * @LastEditTime: 2024-09-22 11:24:09
 * @FilePath: \webextension-pixiv-toolkit\src\background\updates\update6_0_0.js
 */
import { app } from "../Application";
import pathjoin from "@/modules/Util/pathjoin";
import defaultSettings from "@/config/default";

/**
 * Update to 6.0.0
 *
 * Folds the v5 "relative location + rename format" settings into the single
 * rename-rule strings 6.x reads.
 */
export default async () => {
  let settings = await app().getService('setting').getSettings();
  let updateSettings = Object.assign({}, defaultSettings, settings, {
    version: '6.0.0',
  });

  /**
   * Write a migrated rule, but only when the v5 settings it is derived from
   * had something in them. With nothing to migrate, whatever is already on
   * `updateSettings` stands — the user's own 6.x rule if they have one, the
   * default otherwise. Overwriting unconditionally would replace a rule the
   * user had edited with a default the moment this ran a second time.
   */
  const migrateRule = (name, ...parts) => {
    const rule = pathjoin(...parts);

    if (rule) {
      updateSettings[name] = rule;
    }
  };

  /**
   * `ugoiraRenameRule` has no location part, so the format carries over
   * whole rather than being joined.
   */
  migrateRule('ugoiraRenameRule', settings.ugoiraRenameFormat);

  migrateRule(
    'mangaRenameRule',
    settings.mangaRelativeLocation,
    settings.mangaRenameFormat,
    settings.mangaImageRenameFormat
  );

  migrateRule(
    'illustRenameRule',
    settings.illustrationRelativeLocation,
    settings.illustrationRenameFormat,
    settings.illustrationImageRenameFormat
  );

  migrateRule(
    'novelRenameRule',
    settings.novelRelativeLocation,
    settings.novelRenameFormat
  );

  migrateRule(
    'pixivComicEpisodeRenameRule',
    settings.pixivComicRelativeLocation,
    settings.pixivComicImageRenameFormat
  );

  updateSettings.illustrationPageNumberStartWithOne = settings.illustrationPageNumberStartWithOne ? 1 : 0;
  updateSettings.mangaPageNumberStartWithOne = settings.mangaPageNumberStartWithOne ? 1 : 0;
  updateSettings.pixivComicPageNumberStartWithOne = settings.pixivComicPageNumberStartWithOne ? 1 : 0;

  if (updateSettings.globalZipMultipleImages === 0) {
    updateSettings.globalZipMultipleImages = 1;
    updateSettings.downloadSaveMode = 1;
  }

  await app().getService('setting').updateSettings(updateSettings);

  console.log(`update patched, target: 6.0.0`);
}
