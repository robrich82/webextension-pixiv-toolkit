import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { closeAll, launch } from './firefox.mjs';

// The Diagnosis page on Firefox, where the error comes back from IndexedDB
// through Firefox's own structured clone. See docs/testing.md.

let firefox;

afterEach(async () => {
  try {
    await firefox?.close();
  } finally {
    firefox = undefined;
    await closeAll();
  }
});

test('the diagnosis page lists tracked errors without the download manager open', { timeout: 90000 }, async () => {
  firefox = await launch({});
  const { bidi, origin } = firefox;

  // Recorded the way the background's DownloadService records one. The schema is src/modules/Db/Db.js's.
  const seeder = await bidi.openTab(`${origin}/options_page/index.html`);
  await bidi.evaluate(seeder, async () => {
    const db = new Dexie('PixivToolkitDatabase');
    db.version(1).stores({
      histories: '++id,&uid,title,userName,cover,url,type,r,downloaded_at,visited_at',
      tracked_errors: '++id,error,created_at'
    });
    await db.tracked_errors.add({ error: new Error('seeded error'), created_at: Date.UTC(2026, 0, 1) });
    db.close();
  });

  const page = await bidi.openTab(`${origin}/options_page/index.html#/diagnosis_messages`);
  const errorsBox = () => bidi.evaluate(page, () => document.querySelectorAll('.diagnosis-messages textarea')[2]?.value || '');
  let value = '';

  for (const deadline = Date.now() + 20000; !value && Date.now() < deadline;) {
    value = await errorsBox();
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  assert.equal(value, '2026-01-01T00:00:00.000Z Error: seeded error\n');
  const { contexts } = await bidi.send('browsingContext.getTree', {});
  assert.ok(!contexts.some(context => context.url.includes('/options_page/downloads.html')));
  assert.deepEqual(firefox.errors, []);
});
