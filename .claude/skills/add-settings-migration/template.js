import { app } from "../Application";

/**
 * Update to X.Y.Z
 *
 * <What this does to stored settings, and why it is safe for installs that
 * never had the old value.> An existing `newKey` wins over `oldKey`.
 */
export default async () => {
  let settingService = app().getService('setting');
  let { oldKey, newKey } = await settingService.getSetting(['oldKey', 'newKey']);

  if (oldKey !== undefined && newKey === undefined) {
    await settingService.updateSettings({ newKey: oldKey });
  }

  await settingService.removeSettings('oldKey');

  console.log(`update patched, target: X.Y.Z`);
}
