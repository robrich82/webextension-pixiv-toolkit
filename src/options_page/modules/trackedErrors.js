import Db from "@/modules/Db/Db";

/**
 * The errors the background recorded, oldest first, one line each. Read from
 * the shared Dexie database, so it works without the download manager open.
 * @returns {Promise<string[]>}
 */
export async function trackedErrorLines() {
  const items = await Db.getDb().trackedErrorRepo().getItems();

  return items.map(({ error, created_at }) => {
    const message = error && error.message !== undefined ? `${error.name}: ${error.message}` : String(error);

    // An invalid date would make toISOString() throw and lose the whole list.
    const time = new Date(created_at);

    return Number.isNaN(time.getTime()) ? message : `${time.toISOString()} ${message}`;
  });
}
