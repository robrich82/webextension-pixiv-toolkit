/**
 * Moves the v5 visit history out of the PouchDB `illust_histories` store into
 * the Dexie table the History page reads, then destroys the PouchDB store.
 * Nothing has written to that store since 6.0.0, so after this runs nothing
 * reads it either.
 *
 * Entries that aren't usable history are skipped, and as with any import the
 * maxHistoryItems cap then drops the oldest visits. If reading or importing
 * fails, the store is left untouched and the error logged. It does not retry:
 * the update that runs this still completes, so a failure here can't hold
 * back later migrations.
 *
 * @param {import('../services/HistoryService').default} historyService
 * @param {Function} [PouchDB] the PouchDB constructor; specs pass their own
 * @returns {Promise<{ imported: number, skipped: number }|null>} null when the import failed
 */
export default async function migrateIllustHistory(historyService, PouchDB) {
  let db;
  let result;

  try {
    // Required here, not imported, so specs that load the background
    // Application under jsdom don't evaluate the PouchDB bundle (it needs
    // `fetch`). In the extension the global is already loaded either way.
    PouchDB = PouchDB || require('pouchdb');

    db = new PouchDB('illust_histories');

    const { rows } = await db.allDocs({ include_docs: true });
    const docs = rows.filter(row => !row.id.startsWith('_design/')).map(row => row.doc);

    result = await historyService.importItems({ items: docs });
  } catch (error) {
    console.error('Unable to move the v5 visit history into the History page; the PouchDB store was kept', error);

    return null;
  }

  console.info('Moved the v5 visit history into the History page', result);

  try {
    await db.destroy();
  } catch (error) {
    console.error('Moved the v5 visit history, but could not delete the old PouchDB store', error);
  }

  return result;
}
