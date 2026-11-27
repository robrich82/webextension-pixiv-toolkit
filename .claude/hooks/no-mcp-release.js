#!/usr/bin/env node
'use strict';

/**
 * PreToolUse hook for the mise MCP server's run_task: refuses a task that asks
 * for confirmation, such as a release. run_task answers `confirm` itself (it
 * sets MISE_YES=1), so the prompt can't stop it; through Bash, the permission
 * check sees the command.
 *
 * A dry run with nobody to answer finds every prompt the call would reach:
 * through `depends`, `depends_post`, `run = [{ task }]`, an alias or a pattern.
 * It's a guard against accidents, not a sandbox: run_task runs arbitrary code
 * anyway, for example a spec that `test` picks up.
 */

const { spawnSync } = require('child_process');

// On Windows mise hands the arguments to cmd.exe, which ignores `\"`: what
// follows a `"` runs as a command. `%NAME%` expands even inside quotes.
const UNSAFE_ARG = /["%]/;

const VIA_BASH = 'Run it through Bash instead; for a release, follow the release-firefox skill.';

/** A dry run of `task` with nobody to answer `confirm`: CI and MISE_YES would answer it. */
function dryRun(task, args, cwd) {
  const { CI, MISE_QUIET, MISE_SILENT, MISE_TASK_SKIP_DEPENDS, ...env } = process.env;

  return spawnSync('mise', ['run', '--dry-run', task, '--', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...env, MISE_YES: 'false', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000
  });
}

/** Why the call is refused, or null to let it through. */
function refusal(toolInput, cwd) {
  const { task } = toolInput;
  const args = Array.isArray(toolInput.args) ? toolInput.args.map(String) : [];

  if (typeof task !== 'string') {
    return null;
  }

  if (task.startsWith('-')) {
    return `\`${task}\` isn't a task name. ${VIA_BASH}`;
  }

  if (args.some((arg) => UNSAFE_ARG.test(arg))) {
    return `run_task arguments can't contain \`"\` or \`%\`: on Windows, mise passes them to cmd.exe, which would run what follows a \`"\`. ${VIA_BASH}`;
  }

  const result = dryRun(task, args, cwd);

  if (result.error) {
    return `Couldn't dry-run \`${task}\` to check it for a confirmation prompt (${result.error.message}). ${VIA_BASH}`;
  }

  if (/requires confirmation/.test(result.stdout + result.stderr)) {
    return `\`${task}\` asks for confirmation, which the mise MCP server answers itself. ${VIA_BASH}`;
  }

  return null;
}

/** The hook's stdout for one tool call's JSON input; empty unless the call is refused. */
function output(input) {
  let parsed;

  try {
    parsed = JSON.parse(input);
  } catch (error) {
    return '';
  }

  const reason = refusal(parsed?.tool_input ?? {}, process.env.CLAUDE_PROJECT_DIR || parsed?.cwd || process.cwd());

  return reason === null ? '' : JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }
  });
}

let input = '';

process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => process.stdout.write(output(input)));
