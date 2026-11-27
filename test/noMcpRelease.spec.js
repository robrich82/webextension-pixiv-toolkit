/**
 * .claude/hooks/no-mcp-release.js refuses tasks that ask for confirmation when
 * they come through the mise MCP server's run_task, which answers `confirm`
 * itself. Checked against the real mise, in a scratch project.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, '.claude/hooks/no-mcp-release.js');

const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), 'no-mcp-release-'));
const NO_CONFIG = path.join(PROJECT, 'no-such-config.toml');

fs.writeFileSync(path.join(PROJECT, 'mise.toml'), `
[tasks.ask]
run = "echo asked"
confirm = "Really?"

[tasks.plain]
run = "echo plain"

[tasks.after]
depends = ["ask"]
run = "echo after"

[tasks.post]
depends_post = ["ask"]
run = "echo post"

[tasks.nested]
run = [{ task = "ask" }]

[tasks.aliased]
alias = "zz"
confirm = "Sure?"
run = "echo aliased"
`);

afterAll(() => fs.rmSync(PROJECT, { recursive: true, force: true }));

// Only the scratch project's config counts. CI and MISE_YES are set the way
// CI and run_task set them, to show the hook's dry run ignores them.
const env = {
  ...process.env,
  CLAUDE_PROJECT_DIR: PROJECT,
  MISE_GLOBAL_CONFIG_FILE: NO_CONFIG,
  MISE_SYSTEM_CONFIG_FILE: NO_CONFIG,
  MISE_CEILING_PATHS: path.dirname(PROJECT),
  MISE_TRUSTED_CONFIG_PATHS: PROJECT,
  CI: 'true',
  MISE_YES: '1'
};

const hook = (input, hookEnv = env) => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', env: hookEnv, timeout: 30000 });
const runTask = (task, args = []) => JSON.stringify({ tool_name: 'mcp__mise__run_task', tool_input: { task, args } });

const denied = (reason) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: expect.stringContaining(reason) }
});

describe('the hook', { timeout: 30000 }, () => {
  test.each([
    ['a task that asks', 'ask'],
    ['a task that depends on one', 'after'],
    ['a task that runs one afterwards', 'post'],
    ['a task that runs one as a step', 'nested'],
    ['an alias', 'zz'],
    ['a pattern', 'a*']
  ])('refuses %s', (_, task) => {
    const result = hook(runTask(task));

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(denied('asks for confirmation'));
  });

  test.each([
    ['a double quote', ['x" & node scripts/release-firefox.js']],
    ['a variable', ['%PATH%']]
  ])('refuses an argument with %s, which cmd.exe would act on', (_, args) => {
    const result = hook(runTask('plain', args));

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(denied('can\'t contain'));
  });

  test('refuses a flag in place of a task name', () => {
    const result = hook(runTask('--yes'));

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(denied('isn\'t a task name'));
  });

  test('refuses when it cannot run mise to check', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'no-mcp-release-path-'));
    const noMise = Object.fromEntries(Object.entries(env).filter(([name]) => name.toUpperCase() !== 'PATH'));

    try {
      const result = hook(runTask('plain'), { ...noMise, PATH: empty });

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(denied('Couldn\'t dry-run'));
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  test.each([
    ['a task that doesn\'t ask', runTask('plain')],
    ['one with arguments', runTask('plain', ['--coverage.enabled=false', 'test/NameFormatter.spec.js'])],
    // Arguments go after a `--`, so this can't start a second task.
    ['a chain in the arguments', runTask('plain', [':::', 'ask'])],
    ['a task that doesn\'t exist, which run_task reports itself', runTask('no-such-task')],
    ['input that is not JSON', 'not json'],
    ['a call without a task', JSON.stringify({ tool_input: {} })]
  ])('allows %s', (_, input) => {
    const result = hook(input);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('');
  });
});

/** The bash Claude Code runs a `shell: "bash"` hook with: Git Bash on Windows, not WSL's. */
function bash() {
  if (process.platform !== 'win32') return 'bash';
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH) return process.env.CLAUDE_CODE_GIT_BASH_PATH;

  // git.exe sits in Git\cmd or deeper (Git\ucrt64\bin); bash.exe is in Git\bin.
  const gits = spawnSync('where', ['git'], { encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean);
  for (const git of gits) {
    for (let dir = path.dirname(git); dir !== path.dirname(dir); dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'bin', 'bash.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('Git Bash not found; set CLAUDE_CODE_GIT_BASH_PATH.');
}

describe('.claude/settings.json', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude/settings.json'), 'utf8'));
  // Claude Code tests a regular-expression matcher unanchored; this one anchors itself.
  const runs = (tool) => settings.hooks.PreToolUse
    .filter(({ matcher }) => new RegExp(matcher).test(tool))
    .flatMap(({ hooks }) => hooks)
    .find(({ command }) => command.includes('no-mcp-release.js'));

  test.each([
    'mcp__mise__run_task',
    'mcp__mise-dev__run_task',
    'mcp__plugin_mise_mise__run_task'
  ])('runs the hook before %s', (tool) => {
    expect(runs(tool)).toBeDefined();
  });

  test.each([
    'mcp__mise__list_tasks',
    'mcp__other__run_task',
    'Bash'
  ])('leaves %s alone', (tool) => {
    expect(runs(tool)).toBeUndefined();
  });

  test('blocks the call when the hook fails', () => {
    expect(runs('mcp__mise__run_task').onFailure).toBe('block');
  });

  test('runs the hook as Claude Code does', { timeout: 30000 }, () => {
    const entry = runs('mcp__mise__run_task');
    expect(entry.shell).toBe('bash');

    // CLAUDE_PROJECT_DIR locates the hook, so this checks an argument, which needs no task.
    const result = spawnSync(bash(), ['-c', entry.command], {
      input: runTask('plain', ['"']),
      encoding: 'utf8',
      env: { ...env, CLAUDE_PROJECT_DIR: ROOT },
      timeout: 30000
    });
    expect(result.status, result.error?.message ?? result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(denied('can\'t contain'));
  });
});
