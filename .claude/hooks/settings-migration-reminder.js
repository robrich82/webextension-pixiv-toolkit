#!/usr/bin/env node
'use strict';

/**
 * PostToolUse hook: after an Edit/Write to src/config/default.js, remind Claude
 * that existing installs may need a settings migration. Never blocks.
 */

const REMINDER = [
  'src/config/default.js changed. Only fresh installs get these defaults; settings are read raw from storage.local, so existing installs read a new key as undefined and keep their old value for a changed one.',
  'A renamed, removed, re-typed or re-shaped key stays in storage until a migration rewrites it.',
  'Unless this edit only changes comments, load the add-settings-migration skill and decide whether the change needs a migration or a fallback where the setting is read.'
].join(' ');

/** The hook's stdout for one tool call's JSON input; empty unless the defaults were edited. */
function output(input) {
  let filePath;

  try {
    filePath = JSON.parse(input).tool_input.file_path;
  } catch (error) {
    return '';
  }

  if (typeof filePath !== 'string' || !/(^|\/)src\/config\/default\.js$/.test(filePath.replace(/\\/g, '/'))) {
    return '';
  }

  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: REMINDER } });
}

let input = '';

process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => process.stdout.write(output(input)));
