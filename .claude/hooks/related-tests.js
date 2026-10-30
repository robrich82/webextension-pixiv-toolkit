#!/usr/bin/env node
'use strict';

/**
 * PostToolUse hook: after an Edit/Write to a source or spec file, run the Jest
 * specs related to it. Runs in whichever checkout the edited file lives in
 * (main or a worktree), so it follows the file rather than the session.
 * Exit 2 hands the failure back to Claude; anything else stays silent.
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

  while (!fs.existsSync(path.join(root, 'jest.config.js'))) {
    let parent = path.dirname(root);

    if (parent === root) {
      process.exit(0);
    }

    root = parent;
  }

  let relative = path.relative(root, filePath).split(path.sep).join('/');
  let jest = path.join(root, 'node_modules', 'jest', 'bin', 'jest.js');

  if (!/^(src|test)\//.test(relative) || !fs.existsSync(jest)) {
    process.exit(0);
  }

  let result = spawnSync(process.execPath, [
    jest,
    '--config', 'jest.config.js',
    '--coverage=false',
    '--passWithNoTests',
    '--findRelatedTests', relative
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', CI: 'true' }
  });

  if (result.status !== 0) {
    let output = `${result.stdout || ''}${result.stderr || ''}`.trim().split('\n');

    console.error(`Related Jest specs failed for ${relative}:\n${output.slice(-60).join('\n')}`);
    process.exit(2);
  }

  process.exit(0);
});
