/**
 * .claude/hooks/no-mcp-release.js refuses release tasks, and task patterns,
 * sent through the mise MCP server's run_task, which answers `confirm` itself.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, '.claude/hooks/no-mcp-release.js');

const hook = (input) => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 30000 });
const runTask = (task, args = []) => JSON.stringify({ tool_name: 'mcp__mise__run_task', tool_input: { task, args } });

test.each([
  ['the release', 'release:firefox'],
  ['a release for another browser', 'release:chrome'],
  ['a bare release task', 'release'],
  ['a monorepo name', '//:release:firefox'],
  ['a release pattern', 'release:*'],
  ['every task', '*'],
  ['every task, nested', '**'],
  ['a one-character wildcard', 'build:fire?ox'],
  ['a brace pattern', '{build,release:firefox}'],
  ['a class pattern', 'r[e]lease:firefox']
])('refuses %s', (_, task) => {
  const result = hook(runTask(task));

  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: expect.stringContaining('mise run --yes release:firefox')
    }
  });
});

test.each([
  ['a build', runTask('build:firefox')],
  ['the tests, with arguments', runTask('test', ['--coverage.enabled=false', 'test/NameFormatter.spec.js'])],
  // run_task passes arguments after a `--`, so this can't start a second task.
  ['a chain in the arguments', runTask('build', [':::', 'release:firefox'])],
  ['a name that only contains the word', runTask('prerelease-notes')],
  ['input that is not JSON', 'not json'],
  ['a call without a task', JSON.stringify({ tool_input: {} })]
])('allows %s', (_, input) => {
  const result = hook(input);

  expect(result.status).toBe(0);
  expect(result.stdout + result.stderr).toBe('');
});

test('.claude/settings.json runs the hook before every run_task call', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude/settings.json'), 'utf8'));
  const entries = settings.hooks.PreToolUse.filter(({ matcher }) => new RegExp(`^(${matcher})$`).test('mcp__mise__run_task'));
  const commands = entries.flatMap(({ hooks }) => hooks.map(({ command }) => command));
  const guard = commands.find((command) => command.includes('no-mcp-release.js'));
  expect(guard).toBeDefined();

  // The command as Claude Code runs it, through bash with CLAUDE_PROJECT_DIR set.
  const result = spawnSync('bash', ['-c', guard], {
    input: runTask('release:firefox'),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    timeout: 30000
  });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
});
