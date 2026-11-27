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
 * Only a clean dry run is let through, so an error the real run might not hit
 * (a `confirm` template renders only when someone has to answer it) refuses.
 *
 * It guards against accidents and isn't a sandbox. A dry run can't see inside
 * scripts: a script that runs `mise run` inherits MISE_YES=1, and an argument
 * a script takes through `{{usage.*}}` or a pwsh shell isn't quoted.
 */

const { spawnSync } = require('child_process');

// mise quotes the arguments it appends, but on Windows it hands them to cmd.exe,
// which ignores `\"`: what follows a `"` runs as a command, and `%NAME%` expands
// even inside quotes. Refused on every platform, for simplicity.
const UNSAFE_ARG = /["%]/;

// Each answers `confirm`, or skips the dependencies that would reach one.
// Windows env names are case-insensitive, to mise as well.
const SCRUB = new Set(['CI', 'MISE_YES', 'MISE_TASK_SKIP_DEPENDS']);

const VIA_BASH = 'Run it through Bash instead.';

/**
 * A dry run of `task` with nobody to answer `confirm`. --force reaches a task
 * whose sources are fresh only until a dependency rewrites them; --skip-tools
 * keeps it from installing anything.
 */
function dryRun(task, args, cwd) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !SCRUB.has(name.toUpperCase())));

  return spawnSync('mise', ['run', '--dry-run', '--force', '--skip-tools', task, '--', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...env, MISE_YES: 'false', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000
  });
}

/** Why the call is refused, or null to let it through. */
function refusal(toolInput, cwd) {
  const task = toolInput?.task;
  const args = toolInput?.args ?? [];

  // run_task's schema requires both, so anything else is a call this hook can't read.
  if (typeof task !== 'string' || !Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
    return `Couldn't read the run_task call to check it for a confirmation prompt. ${VIA_BASH}`;
  }

  if (task.startsWith('-')) {
    return `\`${task}\` isn't a task name. ${VIA_BASH}`;
  }

  if (args.some((arg) => UNSAFE_ARG.test(arg))) {
    return `run_task arguments can't contain \`"\` or \`%\`, which cmd.exe acts on when mise runs a task on Windows. ${VIA_BASH}`;
  }

  const result = dryRun(task, args, cwd);

  if (result.error) {
    const cause = result.error.code === 'ETIMEDOUT' ? 'it took over 10 seconds' : result.error.message;
    return `Couldn't dry-run \`${task}\` to check it for a confirmation prompt: ${cause}. ${VIA_BASH}`;
  }

  const output = `${result.stdout}${result.stderr}`.trim();

  if (/requires confirmation/.test(output)) {
    return `\`${task}\` reaches a task that asks for confirmation, which the mise MCP server answers itself. `
      + `${VIA_BASH} For a release, follow the release-firefox skill.`;
  }

  if (result.status !== 0) {
    return `The dry run of \`${task}\` failed, so it couldn't be checked for a confirmation prompt. ${VIA_BASH}\n`
      + output.slice(-1500);
  }

  return null;
}

/** The hook's stdout for one tool call's JSON input; empty unless the call is refused. */
function output(input) {
  let parsed;

  try {
    parsed = JSON.parse(input);
  } catch (error) {
    parsed = null;
  }

  const reason = refusal(parsed?.tool_input, process.env.CLAUDE_PROJECT_DIR || parsed?.cwd || process.cwd());

  return reason === null ? '' : JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }
  });
}

let input = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => process.stdout.write(output(input)));
