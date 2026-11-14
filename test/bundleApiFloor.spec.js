/**
 * The checks build.spec.js runs on the real build, here on small fixtures so
 * each is seen to fail.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { compatReports, newerApiUses, versionAdded } from './helpers/bundleApiFloor';

const DEXIE_GUARD = /(?<![\w$])([\w$]+)\.withResolvers&&\([\w$]+\.withResolvers=\1\.withResolvers\)/g;

let out;

beforeEach(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-api-floor-'));
});

afterEach(() => {
  fs.rmSync(out, { recursive: true, force: true });
});

function write(file, content) {
  fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
  fs.writeFileSync(path.join(out, file), content);
}

describe('versionAdded', () => {
  it('reads the version from browser-compat-data', () => {
    expect(versionAdded('javascript.builtins.Array.toSorted', 'chrome')).toBe(110);
  });

  it('skips a partial implementation', () => {
    // Chrome 112 shipped nesting without the relaxed syntax, 120 in full.
    expect(versionAdded('css.selectors.nesting', 'chrome')).toBe(120);
  });

  it('is Infinity where the browser has no support', () => {
    expect(versionAdded('css.properties.interpolate-size', 'firefox')).toBe(Infinity);
  });

  it('refuses a feature browser-compat-data does not have', () => {
    expect(() => versionAdded('javascript.builtins.Array.nope', 'chrome')).toThrow('has no javascript.builtins.Array.nope');
  });
});

describe('newerApiUses', () => {
  it('reports a prototype method and a CSS feature newer than the floor', () => {
    write('options_page/static/a.js', 'export const b = a.toSorted((x, y) => x - y);');
    write('options_page/static/a.css', '.a:not(:has(.b)){color:red}');

    expect(newerApiUses(out, { browser: 'firefox', floor: 109 })).toEqual([
      'options_page/static/a.js: javascript.builtins.Array.toSorted (needs firefox 115)',
      'options_page/static/a.css: css.selectors.has (needs firefox 121)'
    ]);
  });

  it('passes once the floor supports them', () => {
    write('a.js', 'a.toSorted();');
    write('a.css', '.a:has(.b){color:red}');

    expect(newerApiUses(out, { browser: 'firefox', floor: 121 })).toEqual([]);
  });

  it('leaves out guarded uses and accepted features', () => {
    write('a.js', 'j.withResolvers&&(F.withResolvers=j.withResolvers);');
    write('a.css', '.a:has(.b){color:red}');

    expect(newerApiUses(out, { browser: 'firefox', floor: 115, guarded: [DEXIE_GUARD], accepted: ['css.selectors.has'] })).toEqual([]);
  });

  it('still reports an unguarded use next to a guarded one', () => {
    write('a.js', '$j.withResolvers&&(F.withResolvers=$j.withResolvers);Promise.withResolvers();');

    expect(newerApiUses(out, { browser: 'chrome', floor: 111, guarded: [DEXIE_GUARD] })).toEqual([
      'a.js: javascript.builtins.Promise.withResolvers (needs chrome 119)'
    ]);
  });
});

describe('compatReports', () => {
  it('reports a builtin newer than the floor, in a classic script and a module', async () => {
    write('background/background.js', 'Object.hasOwn({}, "a");');
    write('options_page/static/a.js', 'export const c = structuredClone({});');

    expect((await compatReports(out, { browser: 'chrome', floor: 88 })).sort()).toEqual([
      'background/background.js:1 Object.hasOwn() is not supported in Chrome 88',
      'options_page/static/a.js:1 structuredClone is not supported in Chrome 88'
    ]);
  }, 30000);

  it("ignores a file's own eslint-disable comment", async () => {
    write('lib/vendor.js', '/* eslint-disable */\nObject.hasOwn({}, "a");');

    expect(await compatReports(out, { browser: 'chrome', floor: 88 })).toEqual([
      'lib/vendor.js:2 Object.hasOwn() is not supported in Chrome 88'
    ]);
  }, 30000);

  it('reports a file it cannot parse', async () => {
    write('a.js', 'let = = 1;');

    expect(await compatReports(out, { browser: 'chrome', floor: 111 })).toEqual([
      expect.stringMatching(/^a\.js:1 Parsing error/)
    ]);
  }, 30000);

  it('passes code the floor supports', async () => {
    write('a.js', 'Object.hasOwn({}, "a");');

    expect(await compatReports(out, { browser: 'chrome', floor: 111 })).toEqual([]);
  }, 30000);
});
