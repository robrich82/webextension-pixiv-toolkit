#!/usr/bin/env node
/**
 * Builds dist/chrome and zips it for a Chrome Web Store upload, which is done
 * by hand in the developer dashboard.
 *
 *   pnpm run package:chrome
 *
 * Writes dist/pixiv-toolkit-chrome-<version>.zip, outside web-ext-artifacts/,
 * which release-firefox.js empties.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * The build's files, as zip entry names. Leaves out dotfiles (the build's
 * `.ptk-build` marker) and top-level names starting with `_` other than
 * `_locales`: Chrome reserves those, writes `_metadata/` into an unpacked
 * build it has loaded, and the store refuses a zip that has one.
 */
export function packagedFiles(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .filter(name => !name.split('/').some(part => part.startsWith('.')))
    .filter(name => !name.startsWith('_') || name.startsWith('_locales/'))
    .sort();
}

/** Zips `dir` into `zipPath`, refusing a build of any version but `version`. */
export function packageChrome({ dir, version, zipPath }) {
  const manifestPath = path.join(dir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`${manifestPath} not found: build the Chrome extension first.`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (manifest.version !== version) {
    throw new Error(`${path.basename(dir)} is a build of ${manifest.version}, not ${version}.`);
  }

  const files = packagedFiles(dir);
  const zip = zipSync(Object.fromEntries(files.map(name => [name, fs.readFileSync(path.join(dir, name))])), { level: 9 });

  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.writeFileSync(zipPath, zip);

  return { files, sha256: crypto.createHash('sha256').update(zip).digest('hex') };
}

if (import.meta.main) {
  // Imported here so the spec can import this module without loading Vite.
  const { buildExtension } = await import('./build.mjs');
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  try {
    const { out } = await buildExtension({ platform: 'chrome' });
    const zipPath = path.join(root, 'dist', `pixiv-toolkit-chrome-${version}.zip`);
    const { files, sha256 } = packageChrome({ dir: out, version, zipPath });

    console.log(`Packaged ${files.length} files into ${path.relative(process.cwd(), zipPath)}`);
    console.log(`sha256: ${sha256}`);
    console.log('Upload it as a new package at https://chrome.google.com/webstore/devconsole');
  } catch (error) {
    // A bundler error's message already names the file; its stack is the bundler's.
    console.error(error.message || error);
    process.exit(1);
  }
}
