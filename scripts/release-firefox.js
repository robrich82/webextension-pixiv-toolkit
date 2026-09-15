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

function run(cmd, args, options = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...options });
}

function runCapture(cmd, args, options = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...options });
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
  let apiKey = requireEnv('WEB_EXT_API_KEY');
  let apiSecret = requireEnv('WEB_EXT_API_SECRET');

  let version = require(path.join(ROOT, 'package.json')).version;

  console.log(`Releasing Firefox build v${version}`);

  fs.rmSync(ARTIFACTS_DIR, { recursive: true, force: true });

  console.log('\n== Build ==');
  run('pnpm', ['run', 'build:firefox'], {
    env: { ...process.env, NODE_ENV: 'production', PLATFORM_ENV: 'firefox' }
  });

  console.log('\n== Sign ==');
  run('pnpm', [
    'exec', 'web-ext', 'sign',
    '--source-dir', 'dist/firefox',
    '--artifacts-dir', 'web-ext-artifacts',
    '--api-key', apiKey,
    '--api-secret', apiSecret,
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
