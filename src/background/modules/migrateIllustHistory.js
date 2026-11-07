const PREFIX = '_pouch_';
const DB_NAME = `${PREFIX}illust_histories`;
const ADAPTER_VERSION = 5;

/**
 * Moves the v5 visit history out of the PouchDB `illust_histories` store into
 * the Dexie table the History page reads, then deletes the store. Nothing has
 * written to that store since 6.0.0, so after this runs nothing reads it either.
 *
 * The store is read straight from IndexedDB, so the PouchDB library doesn't
 * have to ship. PouchDB's idb adapter (schema version 5, from PouchDB 5 on)
 * keeps one row per document in `document-store`, holding its winning
 * revision, and every revision's body in `by-sequence`, keyed by
 * `<id>::<rev>`. test/fixtures/pouchdbV5 is a real store, for reference.
 *
 * Entries that aren't usable history are skipped, and as with any import the
 * maxHistoryItems cap then drops the oldest visits. If reading or importing
 * fails, the store is left untouched and the error logged. It does not retry:
 * the update that runs this still completes, so a failure here can't hold
 * back later migrations.
 *
 * @param {import('../services/HistoryService').default} historyService
 * @returns {Promise<{ imported: number, skipped: number }|null>} null when the import failed
 */
export default async function migrateIllustHistory(historyService) {
  let contents;
  let result;

  try {
    contents = await readStore();

    if (!contents) {
      return { imported: 0, skipped: 0 };
    }

    result = await historyService.importItems({ items: contents.docs });
  } catch (error) {
    console.error('Unable to move the v5 visit history into the History page; the PouchDB store was kept', error);

    return null;
  }

  console.info('Moved the v5 visit history into the History page', result);

  try {
    // As PouchDB's destroy() does: the store, then the index databases it lists.
    await Promise.all([DB_NAME, ...contents.dependentDbs.map(name => PREFIX + name)].map(deleteDatabase));
  } catch (error) {
    console.error('Moved the v5 visit history, but could not delete the old PouchDB store', error);
  }

  return result;
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Opens the store without creating it: an open that would create the
 * database is aborted in `upgradeneeded`.
 *
 * @returns {Promise<IDBDatabase|null>} null when there is no store
 */
function openStore() {
  return new Promise((resolve, reject) => {
    let missing = false;
    const open = indexedDB.open(DB_NAME);

    open.onupgradeneeded = () => {
      missing = true;
      open.transaction.abort();
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = event => {
      if (missing) {
        // Stops the abort's AbortError surfacing as an uncaught error.
        event.preventDefault();
        resolve(null);
      } else {
        reject(open.error);
      }
    };
  });
}

/**
 * @returns {Promise<{ docs: object[], dependentDbs: string[] }|null>} null when there is no store
 */
async function readStore() {
  const db = await openStore();

  if (!db) {
    return null;
  }

  try {
    if (db.version !== ADAPTER_VERSION) {
      throw new Error(`Unexpected PouchDB idb schema version ${db.version}`);
    }

    const tx = db.transaction(['document-store', 'by-sequence', 'local-store'], 'readonly');
    const [metadata, revisions, dependents] = await Promise.all([
      request(tx.objectStore('document-store').getAll()),
      request(tx.objectStore('by-sequence').getAll()),
      request(tx.objectStore('local-store').get('_local/_pouch_dependentDbs'))
    ]);
    const bodies = new Map(revisions.map(body => [body._doc_id_rev, body]));
    const docs = [];

    metadata.forEach(({ id, winningRev, deletedOrLocal }) => {
      // Deleted documents are marked '1'. Design docs hold pouchdb-find's index definition.
      if (deletedOrLocal === '1' || id.startsWith('_design/')) {
        return;
      }

      const body = bodies.get(`${id}::${winningRev}`);

      if (body) {
        const { _doc_id_rev, ...doc } = body;

        docs.push({ ...doc, _id: id, _rev: winningRev });
      }
    });

    return { docs, dependentDbs: Object.keys(dependents?.dependentDbs ?? {}) };
  } finally {
    db.close();
  }
}

/**
 * Resolves once the deletion is queued if another connection holds the
 * database open; it completes when that connection closes.
 *
 * @param {string} name
 */
function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);

    req.onsuccess = () => resolve();
    req.onblocked = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
