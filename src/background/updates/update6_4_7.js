import { app } from "../Application";

/**
 * Update to 6.4.7
 *
 * Drops the inert `ugoiraConvertTool` setting. It picked between conversion
 * tools before ffmpeg-core was bundled locally; nothing has read the key
 * since, so it is only taking up a slot in the user's settings. Removing it
 * is safe precisely because it is unread — there is no behaviour to
 * preserve, only a stale value to clear out.
 */
export default async () => {
  await app().getService('setting').removeSettings('ugoiraConvertTool');

  console.log(`update patched, target: 6.4.7`);
}
