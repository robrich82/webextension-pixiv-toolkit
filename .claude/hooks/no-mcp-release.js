#!/usr/bin/env node
'use strict';

/**
 * PreToolUse hook for the mise MCP server's run_task: refuses a release task.
 * run_task answers a task's `confirm` prompt itself (it sets MISE_YES=1), so
 * the prompt on `release:firefox` can't stop it; through Bash, the permission
 * check sees the command. A pattern (`release:*`, `*`) could reach the release
 * too, so any name with a glob character is refused as well.
 */

const RELEASE = /(^|[:/])release(:|$)/;
const GLOB = /[*?[\]{}]/;

const REASON = 'Releases don\'t run through the mise MCP server, which answers their confirmation prompt itself. '
  + 'Follow the release-firefox skill, which runs `mise run --yes release:firefox` through Bash. '
  + 'Name other tasks exactly; run_task refuses patterns here.';

/** The hook's stdout for one tool call's JSON input; empty unless the call is refused. */
function output(input) {
  let task;

  try {
    task = JSON.parse(input).tool_input.task;
  } catch (error) {
    return '';
  }

  if (typeof task !== 'string' || !(RELEASE.test(task) || GLOB.test(task))) {
    return '';
  }

  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: REASON }
  });
}

let input = '';

process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => process.stdout.write(output(input)));
