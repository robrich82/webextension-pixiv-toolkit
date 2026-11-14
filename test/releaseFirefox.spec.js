/**
 * The `updates.json` entry scripts/release-firefox.js publishes, built from a
 * real .xpi (a zip) holding the manifest the Firefox build writes.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { strToU8, zipSync } from 'fflate';
import { transformManifest } from '../scripts/manifest.mjs';
import { updateEntry, xpiMinVersion } from '../scripts/release-firefox.js';

const source = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/statics/manifest.json'), 'utf8'));

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

describe('xpiMinVersion', () => {
  it("reads the Firefox build's strict_min_version from the .xpi", () => {
    const manifest = transformManifest(source, { platform: 'firefox', version: '1.2.3', floors: { chrome: '1', firefox: '456' } });
    const xpi = writeXpi('built.xpi', {
      'background/background.js': '',
      'manifest.json': JSON.stringify(manifest),
      'META-INF/cose.sig': ''
    });

    expect(xpiMinVersion(xpi)).toBe('456.0');
  });

  it('is undefined for an .xpi signed before the build set one', () => {
    const xpi = writeXpi('old.xpi', { 'manifest.json': JSON.stringify({ browser_specific_settings: { gecko: { id: 'x' } } }) });

    expect(xpiMinVersion(xpi)).toBeUndefined();
  });

  it('refuses an .xpi without a manifest', () => {
    const xpi = writeXpi('empty.xpi', { 'other.json': '{}' });

    expect(() => xpiMinVersion(xpi)).toThrow('empty.xpi has no manifest.json.');
  });
});

describe('updateEntry', () => {
  const base = { version: '1.2.3', updateLink: 'https://example.test/a.xpi', hash: 'abc' };

  it("carries the minimum version where Firefox's update checker reads it", () => {
    expect(updateEntry({ ...base, strictMinVersion: '115.0' })).toEqual({
      version: '1.2.3',
      update_link: 'https://example.test/a.xpi',
      update_hash: 'sha256:abc',
      applications: { gecko: { strict_min_version: '115.0' } }
    });
  });

  it('leaves applications out when the .xpi declares no minimum', () => {
    expect(updateEntry({ ...base, strictMinVersion: undefined })).toEqual({
      version: '1.2.3',
      update_link: 'https://example.test/a.xpi',
      update_hash: 'sha256:abc'
    });
  });
});
