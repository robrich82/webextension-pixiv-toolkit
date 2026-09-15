#!/usr/bin/env node
'use strict';

/**
 * Build, sign, and self-host a Firefox release of this fork.
 *
 * Firefox refuses to auto-update a self-distributed add-on unless the
 * manifest's `browser_specific_settings.gecko.update_url` points at an
 * update manifest (`updates.json`) it can poll, and that manifest has to
 * list a `update_hash` matching whatever signed .xpi it points at. AMO only
 * lets a given (extension id, version) pair be signed once, so this script
 * runs build -> sign -> publish as one step against the version already set
 * in package.json, rather than leaving a signed-but-unpublished .xpi lying
 * around that doesn't match what's advertised in updates.json.
 *
 * Requires WEB_EXT_API_KEY / WEB_EXT_API_SECRET (a Mozilla AMO API
 * key/secret pair, see https://addons.mozilla.org/developers/addon/api/key/)
 * in the environment, and `gh` authenticated against the robrich82 fork.
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPO = 'robrich82/webextension-pixiv-toolkit';
const EXTENSION_ID = 'webextension-pixiv-toolkit-fork@robrich82';
const ARTIFACTS_DIR = path.join(ROOT, 'web-ext-artifacts');

/**
 * On Windows, `pnpm` only exists as `pnpm.CMD`/`pnpm.ps1` (PATHEXT resolution
 * is a shell feature), so execFileSync('pnpm', ...) fails with ENOENT there.
 * Node refuses to spawn a .cmd/.bat file at all unless shell:true is set
 * (see the child_process docs on Windows batch-file argument escaping), so
 * that's needed here regardless of platform - which is also why the AMO api
 * key/secret are never passed as CLI args below: shell:true only
 * concatenates array args rather than escaping them, so anything with shell
 * metacharacters in it could break out. web-ext reads WEB_EXT_API_KEY /
 * WEB_EXT_API_SECRET from the environment directly (yargs .env('WEB_EXT')),
 * which every spawned child inherits by default, so there's no need to pass
 * them as arguments at all.
 */
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function run(cmd, args, options = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...options });
}

function runCapture(cmd, args, options = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...options });
}

/**
 * Only for pnpm.cmd, and only because Node refuses to spawn a .cmd/.bat file
 * without shell:true. Every argument here is a short, static, developer-
 * controlled token (no secrets, no spaces, no shell metacharacters), which is
 * what makes shell:true's unescaped concatenation acceptable in this one
 * spot - it would not be for anything derived from user input or a secret.
 */
function runPnpm(args, options = {}) {
  console.log(`> ${PNPM} ${args.join(' ')}`);
  return execFileSync(PNPM, args, { stdio: 'inherit', cwd: ROOT, shell: true, ...options });
}

function requireEnv(name) {
  let value = process.env[name];

  if (!value) {
    console.error(`Missing required environment variable ${name}.`);
    console.error('Set it in your own shell (not via this script) before running a release.');
    process.exit(1);
  }

  return value;
}

function sha256(filePath) {
  let hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function main() {
  // Validated up front so a missing credential fails fast with a clear
  // message, but the values themselves are never read here - see runPnpm.
  requireEnv('WEB_EXT_API_KEY');
  requireEnv('WEB_EXT_API_SECRET');

  let version = require(path.join(ROOT, 'package.json')).version;

  console.log(`Releasing Firefox build v${version}`);

  fs.rmSync(ARTIFACTS_DIR, { recursive: true, force: true });

  console.log('\n== Build ==');
  runPnpm(['run', 'build:firefox'], {
    env: { ...process.env, NODE_ENV: 'production', PLATFORM_ENV: 'firefox' }
  });

  console.log('\n== Sign ==');
  runPnpm([
    'exec', 'web-ext', 'sign',
    '--source-dir', 'dist/firefox',
    '--artifacts-dir', 'web-ext-artifacts',
    '--channel', 'unlisted'
  ]);

  let xpiName = fs.readdirSync(ARTIFACTS_DIR).find(name => name.endsWith('.xpi'));

  if (!xpiName) {
    console.error('web-ext sign did not produce a .xpi in web-ext-artifacts/.');
    process.exit(1);
  }

  let xpiPath = path.join(ARTIFACTS_DIR, xpiName);
  let hash = sha256(xpiPath);

  console.log(`\nSigned: ${xpiName}`);
  console.log(`sha256: ${hash}`);

  console.log('\n== Update manifest ==');

  let updateLink = `https://github.com/${REPO}/releases/download/${version}/${xpiName}`;
  let updates = { addons: { [EXTENSION_ID]: { updates: [] } } };

  try {
    let existingRaw = runCapture('gh', [
      'release', 'view', 'latest', '--repo', REPO,
      '--json', 'assets'
    ]);
    let assets = JSON.parse(existingRaw).assets || [];

    if (assets.some(asset => asset.name === 'updates.json')) {
      let tmpFile = path.join(ARTIFACTS_DIR, 'updates.prev.json');
      run('gh', ['release', 'download', 'latest', '--repo', REPO, '-p', 'updates.json', '-O', tmpFile, '--clobber']);
      updates = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    }
  } catch (error) {
    console.log('No existing release/updates.json found, starting fresh.');
  }

  updates.addons[EXTENSION_ID] = updates.addons[EXTENSION_ID] || { updates: [] };
  updates.addons[EXTENSION_ID].updates = updates.addons[EXTENSION_ID].updates
    .filter(entry => entry.version !== version);
  updates.addons[EXTENSION_ID].updates.push({
    version,
    update_link: updateLink,
    update_hash: `sha256:${hash}`
  });

  let updatesPath = path.join(ARTIFACTS_DIR, 'updates.json');
  fs.writeFileSync(updatesPath, JSON.stringify(updates, null, 2));

  console.log('\n== Publish GitHub release ==');
  run('gh', [
    'release', 'create', version,
    '--repo', REPO,
    '--title', `v${version}`,
    '--generate-notes',
    xpiPath,
    updatesPath
  ]);

  console.log(`\nDone. Firefox will offer this update to anyone running an older signed build with update_url set, next time it checks (or via "Check for Updates" in about:debugging / about:addons).`);
}

main();
