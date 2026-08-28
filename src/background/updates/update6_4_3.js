import { app } from "../Application";

/**
 * Update to 6.4.3
 *
 * Drops the inert `downloadMode` setting. It chose between the legacy in-page
 * downloader and the download manager UI; the legacy path was removed in
 * 6.4.3, so nothing reads the key any more and it is only taking up a slot in
 * the user's settings. Removing it is safe precisely because it is unread —
 * there is no behaviour to preserve, only a stale value to clear out.
 */
export default async () => {
  await app().getService('setting').removeSettings('downloadMode');

  console.log(`update patched, target: 6.4.3`);
}
