/**
 * In the extension `pouchdb` is a webpack external: the prebuilt browser
 * bundle plus pouchdb.find.min.js, loaded ahead of the background script.
 * Under Jest it's the Node build with the find plugin registered the same way,
 * on an in-memory adapter so repository specs touch no disk.
 *
 * Databases outlive a single test within a spec file (memdown keeps a store
 * per name), so specs destroy theirs in afterEach.
 */
const PouchDB = require('pouchdb/lib/index.js');

PouchDB.plugin(require('pouchdb-adapter-memory'));
PouchDB.plugin(require('pouchdb-find'));

module.exports = PouchDB.defaults({ adapter: 'memory' });
