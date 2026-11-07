/**
 * Regenerates illustHistories.json: the raw IndexedDB databases that PouchDB
 * 7.2.2 (the version v5 shipped) leaves behind in Chromium after v5's visit
 * history was used, for the specs that read that store without the library.
 * Run by hand; nothing in CI needs it.
 *
 *   npm pack pouchdb@7.2.2 && mkdir pouchdb-7.2.2 && tar xzf pouchdb-7.2.2.tgz -C pouchdb-7.2.2
 *   node test/fixtures/pouchdbV5/generate.js pouchdb-7.2.2/package/dist
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const dist = process.argv[2];

if (!dist) {
  console.error('usage: node generate.js <pouchdb-7.2.2/package/dist>');
  process.exit(1);
}

// Runs in the page: dumps one database's schema and every record.
function dumpDatabase(name) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name);

    open.onerror = () => reject(open.error);
    open.onsuccess = async () => {
      const db = open.result;
      const dump = { name, version: db.version, stores: {} };

      for (const storeName of [...db.objectStoreNames]) {
        const store = db.transaction(storeName).objectStore(storeName);
        const records = [];

        await new Promise(done => {
          const cursor = store.openCursor();

          cursor.onsuccess = () => {
            if (!cursor.result) {
              return done();
            }

            records.push([cursor.result.key, cursor.result.value]);
            cursor.result.continue();
          };
        });

        dump.stores[storeName] = {
          keyPath: store.keyPath,
          autoIncrement: store.autoIncrement,
          indexes: [...store.indexNames].map(index => ({
            name: index,
            keyPath: store.index(index).keyPath,
            unique: store.index(index).unique,
            multiEntry: store.index(index).multiEntry
          })),
          records
        };
      }

      db.close();
      resolve(dump);
    };
  });
}

// Runs in the page: what v5's IllustHistory repository did, plus the revision
// shapes replication could leave (it never replicated, but the reader shouldn't care).
async function useLikeV5() {
  const illust = (id, viewed_at, extra) => ({
    _id: String(id), id: String(id), title: `Illust ${id}`, userId: '7', userName: 'Artist', type: 0, r: false,
    images: { thumb: `https://i.pximg.net/c/250x250/img/${id}_p0.jpg` }, viewed_at, ...extra
  });
  const db = new PouchDB('illust_histories', { revs_limit: 1 });

  await db.createIndex({ index: { fields: ['viewed_at'] } });

  await db.put(illust(1001, 1600000001));
  await db.put(illust(1002, 1600000002, { type: 2, r: true }));
  await db.put({
    _id: 'N3003', id: 'N3003', title: 'Novel 3003', userId: '8', userName: 'Writer', r: false, isNovel: true,
    image: 'https://i.pximg.net/novel-cover/3003.jpg', viewed_at: 1600000003
  });

  // A revisit: v5 merged the visit into the stored doc and put it again.
  await db.put({ ...await db.get('1001'), viewed_at: 1600000010 });

  // Deleted from the History page, or by the cap's trim.
  const deleted = await db.put(illust(1004, 1500000000));
  await db.remove('1004', deleted.rev);

  // Two conflicting leaves: the winner is 1-bbb.
  await db.bulkDocs([
    { ...illust(1005, 1600000005, { title: 'Losing leaf' }), _rev: '1-aaa' },
    { ...illust(1005, 1600000005), _rev: '1-bbb' }
  ], { new_edits: false });

  // A deleted branch beside a live one: the live leaf wins.
  await db.bulkDocs([{ ...illust(1006, 1600000006, { title: 'Deleted branch' }), _rev: '1-zzz' }], { new_edits: false });
  await db.bulkDocs([{ _id: '1006', _rev: '2-ccc', _deleted: true, _revisions: { start: 2, ids: ['ccc', 'zzz'] } }], { new_edits: false });
  await db.bulkDocs([{ ...illust(1006, 1600000006), _rev: '1-yyy' }], { new_edits: false });

  // The History page queried by viewed_at, which builds the index database.
  await db.find({ selector: { viewed_at: { $gte: null } }, sort: [{ viewed_at: 'desc' }] });

  const { rows } = await db.allDocs({ include_docs: true });

  await db.close();

  return rows.filter(row => !row.id.startsWith('_design/')).map(row => row.doc);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();

  // IndexedDB needs a real origin, so serve a blank page and the bundles from one.
  await context.route('https://fixture.test/**', route => {
    const file = new URL(route.request().url()).pathname.slice(1);

    if (!file) {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
    }

    route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(dist, file), 'utf8') });
  });

  const page = await context.newPage();

  await page.goto('https://fixture.test/');
  await page.addScriptTag({ url: 'https://fixture.test/pouchdb.min.js' });
  await page.addScriptTag({ url: 'https://fixture.test/pouchdb.find.min.js' });

  const allDocs = await page.evaluate(useLikeV5);
  const names = await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name).sort());
  const databases = [];

  for (const name of names) {
    databases.push(await page.evaluate(dumpDatabase, name));
  }

  await browser.close();

  const fixture = {
    generatedBy: 'test/fixtures/pouchdbV5/generate.js with pouchdb 7.2.2 in Chromium',
    // What PouchDB's own allDocs({ include_docs: true }) returned, without design docs.
    allDocs,
    databases
  };

  fs.writeFileSync(path.join(__dirname, 'illustHistories.json'), JSON.stringify(fixture, null, 2) + '\n');
  console.log(`wrote ${databases.length} databases: ${names.join(', ')}`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
