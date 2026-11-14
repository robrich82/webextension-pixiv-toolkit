/**
 * What scripts/release-firefox.js reads from the signed .xpi (a zip holding
 * the manifest the Firefox build writes) and the `updates.json` entry it
 * builds from that.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { strToU8, zipSync } from 'fflate';
import { transformManifest } from '../scripts/manifest.mjs';
import { assertXpiVersion, updateEntry, xpiManifest } from '../scripts/release-firefox.js';

const source = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/statics/manifest.json'), 'utf8'));
const built = transformManifest(source, { platform: 'firefox', version: '1.2.3', floors: { chrome: '1', firefox: '456' } });

let tmp;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-release-'));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeXpi(name, files) {
  const xpiPath = path.join(tmp, name);
  const entries = Object.fromEntries(Object.entries(files).map(([file, text]) => [file, strToU8(text)]));

  fs.writeFileSync(xpiPath, zipSync(entries));

  return xpiPath;
}

describe('xpiManifest', () => {
  it("reads the Firefox build's manifest from the .xpi", () => {
    const xpi = writeXpi('built.xpi', {
      'background/background.js': '',
      'manifest.json': JSON.stringify(built),
      'META-INF/cose.sig': ''
    });

    expect(xpiManifest(xpi)).toEqual(built);
  });

  it('refuses an .xpi without a manifest', () => {
    const xpi = writeXpi('empty.xpi', { 'other.json': '{}' });

    expect(() => xpiManifest(xpi)).toThrow('empty.xpi has no manifest.json.');
  });
});

describe('assertXpiVersion', () => {
  it('accepts the .xpi built from this version', () => {
    expect(() => assertXpiVersion(built, '1.2.3', 'a-1.2.3.xpi')).not.toThrow();
  });

  it('refuses an .xpi of another version saved under this one', () => {
    expect(() => assertXpiVersion({ ...built, version: '1.2.2' }, '1.2.3', 'web-ext-artifacts/a-1.2.3.xpi'))
      .toThrow('a-1.2.3.xpi is version 1.2.2, not 1.2.3.');
  });
});

describe('updateEntry', () => {
  const base = { version: '1.2.3', updateLink: 'https://example.test/a.xpi', hash: 'abc' };

  it("carries the .xpi's minimum version where Firefox's update checker reads it", () => {
    expect(updateEntry({ ...base, manifest: built })).toEqual({
      version: '1.2.3',
      update_link: 'https://example.test/a.xpi',
      update_hash: 'sha256:abc',
      applications: { gecko: { strict_min_version: '456.0' } }
    });
  });

  it('leaves applications out for an .xpi signed before the build set a minimum', () => {
    expect(updateEntry({ ...base, manifest: { version: '1.2.3', browser_specific_settings: { gecko: { id: 'x' } } } })).toEqual({
      version: '1.2.3',
      update_link: 'https://example.test/a.xpi',
      update_hash: 'sha256:abc'
    });
  });
});
