/**
 * Compares the shape of a live Pixiv, Fanbox or Pixiv Comic API response with
 * a fixture in test/fixtures, for the pixiv-api-drift skill. The live request
 * runs in the signed-in browser, through a snippet this script prints, and
 * returns key paths and types only, never values.
 *
 *   node scripts/apiShape.mjs snippet <url>              # JS to evaluate on the API's site
 *   node scripts/apiShape.mjs compare <fixture> <shape>  # shape: the snippet's result, saved as a file
 *
 * compare exits 1 when a path the fixture has is missing live or changed type,
 * and 2 when it can't compare.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every key path in `value` (`$.body.urls.original`) with the sorted types
 * seen there. Array elements share one path (`$.body[]`). So do the entries
 * of an object whose key ends in `Map` (Fanbox's `imageMap.*`), and all-digit
 * keys (Pixiv's `userIllusts.*`): both are ids, which stay in the browser.
 * Self-contained: snippet() sends its source to the browser.
 */
export function shapeOf(value) {
  const shape = {};
  const add = (at, type) => {
    shape[at] = shape[at] || [];
    if (!shape[at].includes(type)) shape[at].push(type);
  };
  const walk = (node, at, key) => {
    if (node === null) {
      add(at, 'null');
    } else if (Array.isArray(node)) {
      add(at, 'array');
      node.forEach((item) => walk(item, `${at}[]`, ''));
    } else if (typeof node === 'object') {
      add(at, 'object');
      for (const [childKey, child] of Object.entries(node)) {
        const id = key.endsWith('Map') || /^\d+$/.test(childKey);
        walk(child, `${at}.${id ? '*' : childKey}`, id ? '*' : childKey);
      }
    } else {
      add(at, typeof node);
    }
  };
  walk(value, '$', '');
  for (const types of Object.values(shape)) types.sort();
  return shape;
}

/** The path one level up from `at`, or undefined at the root. */
function parentOf(at) {
  const match = at.match(/^(.*)(\[\]|\.[^.[\]]+)$/);
  return match ? match[1] : undefined;
}

/**
 * The fixture's paths that the live shape lacks or types differently:
 * `missing`, `type` (a type the fixture has that live never shows), or
 * `unverified` (an array or id map that was empty live, or a parent that
 * wasn't an object). Below a path that is already reported missing, nothing more is.
 * Paths only the live response has are ignored: the fixtures are trimmed to
 * what the parsers read.
 */
export function drift(fixture, live) {
  const found = [];
  for (const [at, types] of Object.entries(fixture)) {
    const seen = live[at];
    if (!seen) {
      const parent = parentOf(at);
      if (parent !== undefined && !live[parent]) continue;
      const element = at.endsWith('[]') || at.endsWith('.*');
      const kind = parent === undefined || (!element && live[parent].includes('object')) ? 'missing' : 'unverified';
      found.push({ kind, path: at, fixture: types, live: [] });
    } else if (types.some((type) => !seen.includes(type))) {
      found.push({ kind: 'type', path: at, fixture: types, live: seen });
    }
  }
  return found;
}

/** The hash key Pixiv Comic's read_v4 wants, read from the parser's config rather than copied. */
function comicHashKey() {
  const config = fs.readFileSync(path.join(ROOT, 'src/modules/Parser/PixivComic/config.js'), 'utf8');
  return config.match(/encrypteHashKey = '([^']+)'/)[1];
}

/**
 * JS for the browser's page on the API's own site: fetches `url` with the
 * session's cookies and resolves to the JSON of its shapeOf(), or of
 * `{ error }`. Pixiv Comic's read_v4 also gets the signed headers
 * EpisodeParser sends.
 */
export function snippet(url) {
  const comic = new URL(url).hostname === 'comic.pixiv.net';
  const sign = comic ? `
  const now = new Date();
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  const offset = -now.getTimezoneOffset();
  const time = \`\${now.getFullYear()}-\${pad(now.getMonth() + 1)}-\${pad(now.getDate())}T\${pad(now.getHours())}:\${pad(now.getMinutes())}:\${pad(now.getSeconds())}\${offset < 0 ? '-' : '+'}\${pad(Math.trunc(offset / 60))}:\${pad(offset % 60)}\`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(time + ${JSON.stringify(comicHashKey())}));
  headers['x-client-time'] = time;
  headers['x-client-hash'] = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  headers['x-requested-with'] = 'pixivcomic';` : '';

  return `(async () => {
  const shapeOf = ${shapeOf.toString()};
  const headers = {};${sign}
  try {
    const response = await fetch(${JSON.stringify(url)}, { credentials: 'include', headers });
    if (!response.ok) return JSON.stringify({ error: 'HTTP ' + response.status });
    return JSON.stringify(shapeOf(await response.json()));
  } catch (error) {
    return JSON.stringify({ error: String(error) });
  }
})()`;
}

/**
 * The compare report, one line per finding, and whether anything drifted.
 * Throws when the shape file isn't a snippet result.
 */
export function report(fixtureFile, shapeFile) {
  let live = JSON.parse(fs.readFileSync(shapeFile, 'utf8'));
  // The browser tool's string result, saved with its quotes.
  if (typeof live === 'string') live = JSON.parse(live);
  if (live?.error) return { drifted: true, lines: [`request failed: ${live.error}`] };
  if (!live || typeof live !== 'object' || !live.$) throw new Error(`${shapeFile} is not a shape from the snippet`);
  const found = drift(shapeOf(JSON.parse(fs.readFileSync(fixtureFile, 'utf8'))), live);
  const lines = found.map(({ kind, path: at, fixture, live: seen }) =>
    `${kind.padEnd(10)} ${at}  fixture: ${fixture.join('|')}${seen.length ? `  live: ${seen.join('|')}` : ''}`);
  return { drifted: found.some(({ kind }) => kind !== 'unverified'), lines: lines.length ? lines : ['no drift'] };
}

const isMain = () => {
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

// Exit 1 means drift, so anything that stops the check exits 2.
if (process.argv[1] && isMain()) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'snippet' && args.length === 1) {
      console.log(snippet(args[0]));
    } else if (command === 'compare' && args.length === 2) {
      const { drifted, lines } = report(...args);
      console.log(lines.join('\n'));
      process.exitCode = drifted ? 1 : 0;
    } else {
      console.error('usage: node scripts/apiShape.mjs snippet <url> | compare <fixture> <shape>');
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
