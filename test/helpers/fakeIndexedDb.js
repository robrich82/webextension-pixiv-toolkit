/**
 * An in-memory IndexedDB for specs that use Dexie or IndexedDB. Import it
 * before anything that loads Dexie. jsdom doesn't expose `structuredClone`,
 * which fake-indexeddb clones every value with, so component specs get it
 * from v8.
 */
import v8 from 'v8';

if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = value => v8.deserialize(v8.serialize(value));
}

require('fake-indexeddb/auto');
