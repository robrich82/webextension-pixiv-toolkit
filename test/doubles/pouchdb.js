/**
 * In the extension `pouchdb` is a webpack external: the prebuilt browser
 * bundle plus pouchdb.find.min.js, loaded ahead of the background script.
 * Jest loads the same browser bundle with the find plugin registered, on an
 * in-memory adapter so repository specs touch no disk. Not the Node build:
 * that eagerly loads leveldown's native binary, which has no darwin-arm64
 * prebuild (#189).
 *
 * Databases outlive a single test within a spec file (memdown keeps a store
 * per name), so specs destroy theirs in afterEach.
 */
const PouchDB = require('pouchdb/dist/pouchdb.js');

PouchDB.plugin(require('pouchdb-adapter-memory'));
PouchDB.plugin(require('pouchdb-find'));

module.exports = PouchDB.defaults({ adapter: 'memory' });
