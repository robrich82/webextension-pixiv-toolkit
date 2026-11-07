/**
 * Writes v5's PouchDB `illust_histories` store into fake-indexeddb in the raw
 * layout PouchDB's idb adapter uses, for the specs that read it without the
 * library. Import ./fakeIndexedDb first.
 *
 * `fixture` is a real store (see test/fixtures/pouchdbV5/generate.js).
 * writeStore() builds simpler ones from the fixture's own schema and record
 * shapes, so a spec can list the documents it needs.
 */
import fixture from '../fixtures/pouchdbV5/illustHistories.json';

export { fixture };

export const STORE = '_pouch_illust_histories';

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Creates each database exactly as dumped: version, stores, indexes, records.
 *
 * @param {Array} databases dumps in the fixture's format
 */
export async function restoreDatabases(databases = fixture.databases) {
  for (const dump of databases) {
    const open = indexedDB.open(dump.name, dump.version);

    open.onupgradeneeded = () => {
      Object.entries(dump.stores).forEach(([name, { keyPath, autoIncrement, indexes }]) => {
        const store = open.result.createObjectStore(name, { keyPath, autoIncrement });

        indexes.forEach(index => store.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry }));
      });
    };

    const db = await request(open);
    const tx = db.transaction(Object.keys(dump.stores), 'readwrite');

    Object.entries(dump.stores).forEach(([name, { keyPath, records }]) => {
      const store = tx.objectStore(name);

      records.forEach(([key, value]) => (keyPath === null ? store.put(value, key) : store.put(value)));
    });

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    db.close();
  }
}

/**
 * Writes a store holding one revision of each document. A document with
 * `_deleted: true` is written as deleted.
 *
 * @param {Array<{ _id: string }>} docs
 */
export async function writeStore(docs) {
  const schema = fixture.databases.find(db => db.name === STORE);
  const stores = Object.fromEntries(Object.entries(schema.stores).map(([name, store]) => [name, { ...store, records: [] }]));

  docs.forEach(({ _id, _deleted, ...body }, i) => {
    const seq = i + 1;
    const rev = `1-${String(seq).padStart(32, '0')}`;
    const metadata = {
      id: _id,
      rev,
      rev_tree: [{ pos: 1, ids: [rev.slice(2), _deleted ? { status: 'available', deleted: true } : { status: 'available' }, []] }],
      winningRev: rev,
      deleted: !!_deleted,
      seq
    };

    stores['document-store'].records.push([_id, {
      data: JSON.stringify(metadata), winningRev: rev, deletedOrLocal: _deleted ? '1' : '0', seq, id: _id
    }]);
    stores['by-sequence'].records.push([seq, { ...(_deleted ? { _deleted: true } : body), _doc_id_rev: `${_id}::${rev}` }]);
  });

  await restoreDatabases([{ name: STORE, version: schema.version, stores }]);
}

export async function databaseNames() {
  return (await indexedDB.databases()).map(db => db.name).sort();
}

/** Deletes every PouchDB database; Dexie's is left to its own `delete()`. */
export async function deletePouchDatabases() {
  const names = (await databaseNames()).filter(name => name.startsWith('_pouch_'));

  await Promise.all(names.map(name => request(indexedDB.deleteDatabase(name))));
}
