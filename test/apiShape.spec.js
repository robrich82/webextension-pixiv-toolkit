/**
 * scripts/apiShape.mjs backs the pixiv-api-drift skill: it reduces an API
 * response to key paths and types in the browser, and compares that with a
 * fixture. These cover the shape, the comparison, the browser snippet (run
 * against a stubbed fetch) and the CLI.
 */
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import vm from 'vm';
import { encrypteHashKey } from '@/modules/Parser/PixivComic/config';
import { drift, report, shapeOf, snippet } from '../scripts/apiShape.mjs';

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/apiShape.mjs');
const fixture = (file) => path.join(ROOT, 'test/fixtures', file);
const readFixture = (file) => JSON.parse(fs.readFileSync(fixture(file), 'utf8'));

describe('shapeOf', () => {
  test('lists every path with its types, and no values', () => {
    expect(shapeOf({ error: false, body: { id: '1', tags: ['a', 2], cover: null } })).toEqual({
      '$': ['object'],
      '$.error': ['boolean'],
      '$.body': ['object'],
      '$.body.id': ['string'],
      '$.body.tags': ['array'],
      '$.body.tags[]': ['number', 'string'],
      '$.body.cover': ['null']
    });
  });

  test('folds the id keys of a …Map object into one path', () => {
    const shape = shapeOf({ imageMap: { a1: { id: 'a1' }, zZ9: { id: 'zZ9', width: 3 } } });

    expect(shape).toEqual({
      '$': ['object'],
      '$.imageMap': ['object'],
      '$.imageMap.*': ['object'],
      '$.imageMap.*.id': ['string'],
      '$.imageMap.*.width': ['number']
    });
  });

  test('folds all-digit keys, so work ids stay out of the shape', () => {
    expect(shapeOf({ userIllusts: { 12345: { id: '12345' }, 678: null } })).toEqual({
      '$': ['object'],
      '$.userIllusts': ['object'],
      '$.userIllusts.*': ['null', 'object'],
      '$.userIllusts.*.id': ['string']
    });
  });

  test('keeps the fields of a map entry whose id happens to end in Map', () => {
    expect(shapeOf({ imageMap: { abcMap: { id: 'x' } } })).toHaveProperty(['$.imageMap.*.id']);
  });
});

describe('drift', () => {
  const base = { body: { id: '1', urls: { original: 'x' }, pages: [{ url: 'u' }] } };

  test('finds nothing when the live response matches, or only adds keys', () => {
    expect(drift(shapeOf(base), shapeOf(base))).toEqual([]);
    expect(drift(shapeOf(base), shapeOf({ ...base, extra: 1 }))).toEqual([]);
  });

  test('reports a missing key once, not every key under it', () => {
    const live = { body: { id: '1', pages: [{ url: 'u' }] } };

    expect(drift(shapeOf(base), shapeOf(live))).toEqual([
      { kind: 'missing', path: '$.body.urls', fixture: ['object'], live: [] }
    ]);
  });

  test('reports a changed type', () => {
    const live = { body: { ...base.body, id: 1 } };

    expect(drift(shapeOf(base), shapeOf(live))).toEqual([
      { kind: 'type', path: '$.body.id', fixture: ['string'], live: ['number'] }
    ]);
  });

  test('accepts a live value that is sometimes another type too', () => {
    const live = { body: { ...base.body, pages: [{ url: 'u' }, { url: null }] } };

    expect(drift(shapeOf(base), shapeOf(live))).toEqual([]);
  });

  test('cannot tell what an empty array holds', () => {
    const live = { body: { ...base.body, pages: [] } };

    expect(drift(shapeOf(base), shapeOf(live))).toEqual([
      { kind: 'unverified', path: '$.body.pages[]', fixture: ['object'], live: [] }
    ]);
  });

  test('cannot tell what a null parent would hold', () => {
    const live = { body: { ...base.body, urls: null } };

    expect(drift(shapeOf(base), shapeOf(live))).toEqual([
      { kind: 'type', path: '$.body.urls', fixture: ['object'], live: ['null'] },
      { kind: 'unverified', path: '$.body.urls.original', fixture: ['string'], live: [] }
    ]);
  });

  test('cannot tell what an empty id map holds', () => {
    const fixtureShape = shapeOf({ imageMap: { a: { id: 'a' } } });

    expect(drift(fixtureShape, shapeOf({ imageMap: {} }))).toEqual([
      { kind: 'unverified', path: '$.imageMap.*', fixture: ['object'], live: [] }
    ]);
  });

  test('reports an array that became an object, without guessing at its elements', () => {
    expect(drift(shapeOf({ pages: [{ url: 'u' }] }), shapeOf({ pages: { url: 'u' } }))).toEqual([
      { kind: 'type', path: '$.pages', fixture: ['array'], live: ['object'] },
      { kind: 'unverified', path: '$.pages[]', fixture: ['object'], live: [] }
    ]);
  });

  test('reports the root of an empty shape as missing', () => {
    expect(drift(shapeOf({ a: 1 }), {})).toEqual([{ kind: 'missing', path: '$', fixture: ['object'], live: [] }]);
  });

  test('matches a Fanbox post whose imageMap has other ids', () => {
    const live = readFixture('fanbox/post-article.json');
    const { img1, img2 } = live.body.post.body.imageMap;
    live.body.post.body.imageMap = { Xk3pQ: img1, b72Lm: img2 };

    expect(drift(shapeOf(readFixture('fanbox/post-article.json')), shapeOf(live))).toEqual([]);
  });
});

describe('snippet', () => {
  /** Runs the snippet in a sandbox whose fetch answers with `body`, and records the request. */
  async function evaluate(url, body, { ok = true, status = 200 } = {}) {
    const requests = [];
    const fetch = async (target, init) => {
      requests.push({ target, init });
      return { ok, status, json: async () => body };
    };
    const context = vm.createContext({ fetch, crypto: globalThis.crypto, TextEncoder });
    const result = JSON.parse(await vm.runInContext(snippet(url), context));

    return { result, requests };
  }

  test('fetches with the session and returns only the shape', async () => {
    const body = readFixture('pixiv/illust-single.json');
    const { result, requests } = await evaluate('https://www.pixiv.net/ajax/illust/1', body);

    expect(result).toEqual(shapeOf(body));
    expect(JSON.stringify(result)).not.toContain(body.body.title);
    expect(requests).toEqual([{ target: 'https://www.pixiv.net/ajax/illust/1', init: { credentials: 'include', headers: {} } }]);
  });

  test('signs a Pixiv Comic request the way EpisodeParser does', async () => {
    const { requests } = await evaluate('https://comic.pixiv.net/api/app/episodes/1/read_v4', readFixture('pixivComic/episode.json'));
    const { headers } = requests[0].init;

    expect(headers['x-client-time']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(headers['x-client-hash']).toBe(crypto.createHash('sha256').update(headers['x-client-time'] + encrypteHashKey).digest('hex'));
    expect(headers['x-requested-with']).toBe('pixivcomic');
  });

  // CI runs in UTC, so the offset is only exercised in a child process with its own TZ.
  test.each(['UTC', 'America/St_Johns', 'Asia/Kathmandu', 'Pacific/Chatham'])('formats x-client-time as moment does in %s', (tz) => {
    const program = `
      import vm from 'node:vm';
      import moment from 'moment';
      import { snippet } from ${JSON.stringify(pathToFileURL(SCRIPT).href)};
      const FIXED = Date.UTC(2026, 0, 5, 3, 4, 5);
      class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [FIXED])); } }
      let headers;
      const fetch = async (url, init) => { headers = init.headers; return { ok: true, json: async () => ({}) }; };
      await vm.runInContext(snippet('https://comic.pixiv.net/api/app/episodes/1/read_v4'), vm.createContext({ fetch, crypto, TextEncoder, Date: FixedDate }));
      console.log(JSON.stringify([headers['x-client-time'], moment(FIXED).format('YYYY-MM-DDTHH:mm:ssZ')]));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, TZ: tz } });
    const [sent, expected] = JSON.parse(result.stdout);

    expect(sent).toBe(expected);
  });

  test('returns the status of a failed request', async () => {
    const { result } = await evaluate('https://www.pixiv.net/ajax/novel/1', {}, { ok: false, status: 404 });

    expect(result).toEqual({ error: 'HTTP 404' });
  });

  test('returns the error when the request throws', async () => {
    const context = vm.createContext({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
    const result = JSON.parse(await vm.runInContext(snippet('https://api.fanbox.cc/post.info?postId=1'), context));

    expect(result).toEqual({ error: 'TypeError: Failed to fetch' });
  });
});

describe('the CLI', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-api-shape-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const compare = (fixtureFile, shape) => {
    const shapeFile = path.join(tmp, 'live.json');
    fs.writeFileSync(shapeFile, JSON.stringify(shape));

    return spawnSync(process.execPath, [SCRIPT, 'compare', fixture(fixtureFile), shapeFile], { encoding: 'utf8' });
  };

  test('exits 0 when the live shape matches', () => {
    const result = compare('pixiv/novel-single.json', shapeOf(readFixture('pixiv/novel-single.json')));

    expect(result.stdout.trim()).toBe('no drift');
    expect(result.status).toBe(0);
  });

  test('exits 1 and names the path when a key went missing', () => {
    const live = readFixture('pixiv/illust-single.json');
    delete live.body.illustTitle;
    const result = compare('pixiv/illust-single.json', shapeOf(live));

    expect(result.stdout).toMatch(/^missing +\$\.body\.illustTitle +fixture: string$/m);
    expect(result.status).toBe(1);
  });

  test('exits 1 and shows both types when a key changed type', () => {
    const live = readFixture('pixiv/illust-single.json');
    live.body.pageCount = '1';
    const result = compare('pixiv/illust-single.json', shapeOf(live));

    expect(result.stdout).toMatch(/^type +\$\.body\.pageCount +fixture: number +live: string$/m);
    expect(result.status).toBe(1);
  });

  test('exits 0 when every finding is unverified', () => {
    const live = readFixture('pixiv/illust-ugoira-meta.json');
    live.body.frames = [];
    const result = compare('pixiv/illust-ugoira-meta.json', shapeOf(live));

    expect(result.stdout).toMatch(/^unverified +\$\.body\.frames\[\]/m);
    expect(result.status).toBe(0);
  });

  test('reads a shape saved as the JSON string the browser tool returned', () => {
    const result = compare('pixiv/novel-single.json', JSON.stringify(shapeOf(readFixture('pixiv/novel-single.json'))));

    expect(result.stdout.trim()).toBe('no drift');
    expect(result.status).toBe(0);
  });

  test.each([
    ['a file that is not a shape', null],
    ['a raw response instead of its shape', { error: false, body: {} }]
  ])('exits 2 for %s', (_, content) => {
    const result = compare('pixiv/novel-single.json', content);

    expect(result.stderr).toMatch(/is not a shape from the snippet/);
    expect(result.status).toBe(2);
  });

  test('exits 1 when the request failed', () => {
    const result = compare('pixiv/illust-single.json', { error: 'HTTP 403' });

    expect(result.stdout.trim()).toBe('request failed: HTTP 403');
    expect(result.status).toBe(1);
  });

  test('prints a snippet that parses', () => {
    const result = spawnSync(process.execPath, [SCRIPT, 'snippet', 'https://www.pixiv.net/ajax/illust/1'], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(() => new vm.Script(result.stdout)).not.toThrow();
  });

  test('exits 2 for a URL it cannot parse', () => {
    const result = spawnSync(process.execPath, [SCRIPT, 'snippet', 'not a url'], { encoding: 'utf8' });

    expect(result.stderr).toMatch(/Invalid URL/);
    expect(result.status).toBe(2);
  });

  test('exits 2 with usage on bad arguments', () => {
    const result = spawnSync(process.execPath, [SCRIPT, 'compare', 'one'], { encoding: 'utf8' });

    expect(result.stderr).toMatch(/^usage:/);
    expect(result.status).toBe(2);
  });

  test('report() reads the same files', () => {
    const shapeFile = path.join(tmp, 'live.json');
    fs.writeFileSync(shapeFile, JSON.stringify(shapeOf(readFixture('pixivComic/episode.json'))));

    expect(report(fixture('pixivComic/episode.json'), shapeFile)).toEqual({ drifted: false, lines: ['no drift'] });
  });
});
