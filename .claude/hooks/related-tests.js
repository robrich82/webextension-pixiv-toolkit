#!/usr/bin/env node
'use strict';

/**
 * PostToolUse hook: after an Edit/Write to a source, script or spec file, run the
 * Vitest specs related to it. Runs in whichever checkout the edited file lives in
 * (main or a worktree), so it follows the file rather than the session.
 * Exit 2 hands spec failures back to Claude; a skipped or unfinished run is
 * reported to the user only.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Files that specs read with fs rather than import, which `vitest related` can't trace.
const READ_BY = [
  [/^src\/statics\/_locales\//, ['test/i18nKeys.spec.js']],
  [/^src\/statics\/HISTORY_/, ['test/components/ChangeLog.spec.js']],
  [/^src\/statics\/manifest\.json$/, ['test/manifest.spec.js', 'test/releaseFirefox.spec.js']],
  [/^package\.json$/, ['test/engines.spec.js', 'test/manifest.spec.js', 'test/toolchainPins.spec.js']],
  [/^mise\.(toml|lock)$/, ['test/toolchainPins.spec.js']]
];

/**
 * What to pass to `vitest related` for an edit to `relative` (repo-relative,
 * forward slashes): the file itself when Vitest can trace it through imports,
 * plus the specs that read it. Empty when no spec depends on it.
 */
function relatedArgs(relative) {
  let args = /^(src|test|scripts)\/.*\.(js|mjs|cjs|vue|json)$/.test(relative) ? [relative] : [];

  for (let [pattern, specs] of READ_BY) {
    if (pattern.test(relative)) {
      args.push(...specs);
    }
  }

  return [...new Set(args)];
}

function run(input) {
  let filePath;

  try {
    filePath = JSON.parse(input).tool_input.file_path;
  } catch (error) {
    return 0;
  }

  if (!filePath) {
    return 0;
  }

  filePath = path.resolve(filePath);

  let root = path.dirname(filePath);

  while (!fs.existsSync(path.join(root, 'vitest.config.mjs'))) {
    let parent = path.dirname(root);

    if (parent === root) {
      return 0;
    }

    root = parent;
  }

  let relative = path.relative(root, filePath).split(path.sep).join('/');
  let args = relatedArgs(relative);
  let vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');

  if (!args.length) {
    return 0;
  }

  if (!fs.existsSync(vitest)) {
    // Visible but non-blocking: a fresh worktree has no node_modules until `pnpm install`.
    console.log(JSON.stringify({ systemMessage: `related-tests: skipped, no node_modules in ${root} (run pnpm install)` }));
    return 0;
  }

  let result = spawnSync(process.execPath, [
    vitest,
    'related', ...args,
    '--run',
    '--coverage.enabled=false',
    '--passWithNoTests'
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', CI: 'true' },
    // Inside the hook's own 180s timeout, so Vitest is stopped rather than orphaned.
    timeout: 170000,
    maxBuffer: 16 * 1024 * 1024
  });

  if (result.error || result.signal) {
    // Exit 1 is shown to the user without blocking; this isn't a test failure.
    console.error(`related-tests: Vitest did not finish for ${relative} (${result.error ? result.error.code || result.error.message : result.signal})`);
    return 1;
  }

  if (result.status !== 0) {
    let output = `${result.stdout || ''}${result.stderr || ''}`.trim().split(/\r?\n/);

    console.error(`Related Vitest specs failed for ${relative}:\n${output.slice(-60).join('\n')}`);
    return 2;
  }

  return 0;
}

if (require.main === module) {
  let input = '';

  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => process.exit(run(input)));
}

module.exports = { READ_BY, relatedArgs };
