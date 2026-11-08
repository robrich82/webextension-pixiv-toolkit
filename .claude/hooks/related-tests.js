#!/usr/bin/env node
'use strict';

/**
 * PostToolUse hook: after an Edit/Write to a source or spec file, run the Vitest
 * specs related to it. Runs in whichever checkout the edited file lives in
 * (main or a worktree), so it follows the file rather than the session.
 * Exit 2 hands spec failures back to Claude; a skipped or unfinished run is
 * reported to the user only.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let input = '';

process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  let filePath;

  try {
    filePath = JSON.parse(input).tool_input.file_path;
  } catch (error) {
    process.exit(0);
  }

  if (!filePath || !/\.(js|vue)$/.test(filePath)) {
    process.exit(0);
  }

  filePath = path.resolve(filePath);

  let root = path.dirname(filePath);

  while (!fs.existsSync(path.join(root, 'vitest.config.mjs'))) {
    let parent = path.dirname(root);

    if (parent === root) {
      process.exit(0);
    }

    root = parent;
  }

  let relative = path.relative(root, filePath).split(path.sep).join('/');
  let vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');

  if (!/^(src|test)\//.test(relative)) {
    process.exit(0);
  }

  if (!fs.existsSync(vitest)) {
    // Visible but non-blocking: a fresh worktree has no node_modules until `pnpm install`.
    console.log(JSON.stringify({ systemMessage: `related-tests: skipped, no node_modules in ${root} (run pnpm install)` }));
    process.exit(0);
  }

  let result = spawnSync(process.execPath, [
    vitest,
    'related', relative,
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
    process.exit(1);
  }

  if (result.status !== 0) {
    let output = `${result.stdout || ''}${result.stderr || ''}`.trim().split(/\r?\n/);

    console.error(`Related Vitest specs failed for ${relative}:\n${output.slice(-60).join('\n')}`);
    process.exit(2);
  }

  process.exit(0);
});
