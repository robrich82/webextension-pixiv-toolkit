/**
 * Packages a real Chrome build, then reads the zip back as the Chrome Web
 * Store would: manifest.json at the root and no names Chrome reserves.
 */
import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { strFromU8, unzipSync } from 'fflate';
import { packageChrome, packagedFiles } from '../scripts/package-chrome.mjs';

const run = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let tmp;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-package-'));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
});

function writeTree(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }

  return dir;
}

describe('a real Chrome build', () => {
  let build;
  let zipPath;
  let result;
  let entries;

  beforeAll(async () => {
    build = path.join(tmp, 'chrome');
    await run(process.execPath, [path.join(ROOT, 'scripts/build.mjs'), '--platform=chrome', `--out-dir=${build}`], { cwd: ROOT });
    // What Chrome writes into an unpacked build it has loaded.
    writeTree(build, { '_metadata/generated_indexed_rulesets/_ruleset1': 'x' });

    zipPath = path.join(tmp, 'out', `pixiv-toolkit-chrome-${version}.zip`);
    result = packageChrome({ dir: build, version, zipPath });
    entries = unzipSync(fs.readFileSync(zipPath));
  }, 120000);

  it("puts this version's manifest at the zip's root", () => {
    expect(JSON.parse(strFromU8(entries['manifest.json'])).version).toBe(version);
  });

  it('holds every built file byte for byte, besides the marker and _metadata', () => {
    const built = fs.readdirSync(build, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => path.relative(build, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
      .filter(name => name !== '.ptk-build' && !name.startsWith('_metadata/'))
      .sort();

    expect(Object.keys(entries).sort()).toEqual(built);
    expect(built).toContain('_locales/en/messages.json');

    for (const name of built) {
      expect(Buffer.from(entries[name]).equals(fs.readFileSync(path.join(build, name))), name).toBe(true);
    }
  });

  it("reports the files and the zip's sha256", () => {
    expect(result.files).toEqual(Object.keys(entries).sort());
    expect(result.sha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex'));
  });
});

describe('packagedFiles', () => {
  it('leaves out dotfiles and reserved top-level _ names, but keeps _locales', () => {
    const dir = writeTree(path.join(tmp, 'names'), {
      'manifest.json': '{}',
      '.ptk-build': '',
      'lib/.hidden': '',
      '_metadata/verified_contents.json': '',
      '_other.js': '',
      '_locales/en/messages.json': '{}',
      'lib/_underscore.js': ''
    });

    expect(packagedFiles(dir)).toEqual(['_locales/en/messages.json', 'lib/_underscore.js', 'manifest.json']);
  });
});

describe('packageChrome refuses', () => {
  it('a build of another version, and writes nothing', () => {
    const dir = writeTree(path.join(tmp, 'old'), { 'manifest.json': JSON.stringify({ version: '0.0.1' }) });
    const zipPath = path.join(tmp, 'old.zip');

    expect(() => packageChrome({ dir, version: '9.9.9', zipPath })).toThrow('old is a build of 0.0.1, not 9.9.9.');
    expect(fs.existsSync(zipPath)).toBe(false);
  });

  it('a directory with no build in it', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'empty-'));

    expect(() => packageChrome({ dir, version, zipPath: path.join(tmp, 'empty.zip') })).toThrow('build the Chrome extension first');
  });
});
