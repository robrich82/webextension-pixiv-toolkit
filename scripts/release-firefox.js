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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function amoAuthHeader() {
  let encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  let now = Math.floor(Date.now() / 1000);
  let unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    iss: process.env.WEB_EXT_API_KEY,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 60
  })}`;
  let signature = crypto.createHmac('sha256', process.env.WEB_EXT_API_SECRET)
    .update(unsigned)
    .digest('base64url');

  return `JWT ${unsigned}.${signature}`;
}

/**
 * Whether AMO already has this version: 'present', 'absent', or 'unknown'
 * if it couldn't be asked (the same TLS resets that broke the sign step).
 */
async function amoVersionState(version) {
  let url = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(EXTENSION_ID)}/versions/${encodeURIComponent(version)}/`;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      let response = await fetch(url, {
        headers: { Authorization: amoAuthHeader() },
        signal: AbortSignal.timeout(30000)
      });

      if (response.ok) {
        return 'present';
      }

      if (response.status === 404) {
        return 'absent';
      }

      console.log(`AMO version check returned ${response.status}.`);
    } catch (error) {
      console.log(`AMO version check failed (${error.message}).`);
    }

    await sleep(5000);
  }

  return 'unknown';
}

/**
 * `web-ext sign` makes several HTTPS round trips to addons.mozilla.org and
 * retries none of them, and requests to that API reset the TLS handshake
 * about 1 in 3 times. Once validation passes, web-ext creates the version on
 * AMO before it polls for approval and downloads the signed file, and AMO
 * refuses a second upload of that version. So a failed attempt is retried
 * only if AMO confirms it has no record of the version.
 */
async function sign(version, xpiName) {
  const attempts = 5;

  for (let attempt = 1; ; attempt++) {
    try {
      runPnpm([
        'exec', 'web-ext', 'sign',
        '--source-dir', 'dist/firefox',
        '--artifacts-dir', 'web-ext-artifacts',
        '--channel', 'unlisted'
      ]);
      return;
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }

      console.log(`\nAttempt ${attempt}/${attempts} failed (${error.message}). Checking whether AMO already has v${version}...`);
      let state = await amoVersionState(version);

      if (state !== 'absent') {
        console.error(state === 'present'
          ? `\nAMO already has v${version}, so signing can't be retried.`
          : `\nCouldn't confirm whether AMO has v${version}, so signing wasn't retried.`);
        console.error('If https://addons.mozilla.org/developers/addons lists the version, download its signed .xpi once');
        console.error(`approved, save it as web-ext-artifacts/${xpiName}, and rerun this script to publish it.`);
        console.error('If AMO has no record of the version, just rerun.');
        throw error;
      }

      console.log('AMO has no record of it, retrying in 10s...');
      await sleep(10000);
    }
  }
}

async function main() {
  // Validated up front so a missing credential fails fast with a clear
  // message. They reach web-ext through the environment, never as arguments
  // (see runPnpm).
  requireEnv('WEB_EXT_API_KEY');
  requireEnv('WEB_EXT_API_SECRET');

  let version = require(path.join(ROOT, 'package.json')).version;

  console.log(`Releasing Firefox build v${version}`);

  // web-ext names the signed file after a hash of the extension id
  // (e.g. 44b1f306226b4b62a10f-6.4.4.xpi), which is meaningless on the
  // release page. Renaming doesn't touch the file's bytes or its AMO
  // signature, so it's safe to do after signing.
  let xpiName = `pixiv-toolkit-firefox-${version}.xpi`;
  let xpiPath = path.join(ARTIFACTS_DIR, xpiName);

  if (fs.existsSync(xpiPath)) {
    // A previous run signed this version but didn't publish it. AMO won't
    // sign it again, so publish the file that's already here.
    console.log(`\nFound ${path.relative(ROOT, xpiPath)}, skipping build and sign.`);
  } else {
    fs.rmSync(ARTIFACTS_DIR, { recursive: true, force: true });

    console.log('\n== Build ==');
    runPnpm(['run', 'build:firefox'], {
      env: { ...process.env, NODE_ENV: 'production', PLATFORM_ENV: 'firefox' }
    });

    console.log('\n== Sign ==');
    await sign(version, xpiName);

    let signedName = fs.readdirSync(ARTIFACTS_DIR).find(name => name.endsWith(`-${version}.xpi`));

    if (!signedName) {
      console.error('web-ext sign did not produce a .xpi in web-ext-artifacts/.');
      process.exit(1);
    }

    fs.renameSync(path.join(ARTIFACTS_DIR, signedName), xpiPath);
  }

  let hash = sha256(xpiPath);

  console.log(`\nSigned: ${xpiName}`);
  console.log(`sha256: ${hash}`);

  console.log('\n== Update manifest ==');

  let updateLink = `https://github.com/${REPO}/releases/download/${version}/${xpiName}`;
  let updates = { addons: { [EXTENSION_ID]: { updates: [] } } };

  try {
    let existingRaw = runCapture('gh', [
      'release', 'view', '--repo', REPO,
      '--json', 'assets'
    ]);
    let assets = JSON.parse(existingRaw).assets || [];

    if (assets.some(asset => asset.name === 'updates.json')) {
      let tmpFile = path.join(ARTIFACTS_DIR, 'updates.prev.json');
      run('gh', ['release', 'download', '--repo', REPO, '-p', 'updates.json', '-O', tmpFile, '--clobber']);
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

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
