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

# The real run, which answers for itself, never renders the message.
[tasks.templated]
usage = 'arg "[version]"'
confirm = "Release {{ usage.version }}?"
run = "echo templated"

# Once it has run, fresh is up to date in a dry run, which doesn't run gen,
# and stale in a real run, once gen has rewritten src.txt.
[tasks.gen]
run = "echo gen > src.txt"

[tasks.fresh]
depends = ["gen"]
sources = ["src.txt"]
outputs = ["out.txt"]
confirm = "Really?"
run = "echo fresh > out.txt"

[tasks.wordy]
run = "echo this requires confirmation, as certs are not trusted"

[tasks.untouched]
sources = ["mise.toml"]
run = "echo untouched ran"
`);

afterAll(() => fs.rmSync(PROJECT, { recursive: true, force: true }));

// Only the scratch project's config and state count. CI and MISE_YES are set
// the way CI and run_task set them, and MISE_TASK_SKIP_DEPENDS too, to show the
// hook's dry run ignores them.
const env = {
  ...process.env,
  CLAUDE_PROJECT_DIR: PROJECT,
  MISE_GLOBAL_CONFIG_FILE: NO_CONFIG,
  MISE_SYSTEM_CONFIG_FILE: NO_CONFIG,
  MISE_CEILING_PATHS: path.dirname(PROJECT),
  MISE_TRUSTED_CONFIG_PATHS: PROJECT,
  MISE_STATE_DIR: path.join(PROJECT, '.state'),
  CI: 'true',
  MISE_YES: '1',
  MISE_TASK_SKIP_DEPENDS: '1'
};

// mise records the sources' state after a real run; this one answers `confirm` through CI.
beforeAll(() => {
  const { MISE_TASK_SKIP_DEPENDS, ...setup } = env;
  const result = spawnSync('mise', ['run', 'fresh'], { cwd: PROJECT, env: setup, encoding: 'utf8', timeout: 30000 });
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
}, 30000);

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
    ['a pattern', 'a*'],
    ['a task whose sources only look fresh', 'fresh']
  ])('refuses %s', (_, task) => {
    const result = hook(runTask(task));

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(denied('asks for confirmation'));
  });

  // A dry run records the sources as if the task had run; this one mustn't.
  test('leaves a task it allows to run, not skipped as up to date', () => {
    const result = hook(runTask('untouched'));
    expect(result.stdout, result.stderr).toBe('');

    const run = spawnSync('mise', ['run', 'untouched'], { cwd: PROJECT, env, encoding: 'utf8', timeout: 30000 });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('untouched ran');
  });

  // run_task refuses a config nobody trusted; the dry run mustn't load it first.
  // The project trusts nothing by path, and mise trusts everything on a CI runner.
  describe('a project that is not trusted', () => {
    const { MISE_TRUSTED_CONFIG_PATHS, GITHUB_ACTIONS, CONTINUOUS_INTEGRATION, ...rest } = env;
    let dir;
    let untrusted;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-mcp-release-untrusted-'));
      fs.writeFileSync(path.join(dir, 'mise.toml'), `
[env]
MARK = "{{ exec(command='echo x > MARKER') }}"

[tasks.plain]
run = "echo plain"
`);
      untrusted = { ...rest, CLAUDE_PROJECT_DIR: dir, MISE_CEILING_PATHS: path.dirname(dir) };
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const refusesWithoutLoading = () => {
      const result = hook(runTask('plain'), untrusted);

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(denied('Ask the user'));
      expect(fs.existsSync(path.join(dir, 'MARKER'))).toBe(false);
    };

    test('is refused without its config running', refusesWithoutLoading);

    // `mise trust --ignore` keeps the trust record; run_task honours the ignore.
    test('is refused once ignored after being trusted', () => {
      for (const args of [['trust', dir], ['trust', '--ignore', dir]]) {
        const result = spawnSync('mise', args, { cwd: dir, env: untrusted, encoding: 'utf8', timeout: 30000 });
        expect(result.status, result.stderr).toBe(0);
      }

      refusesWithoutLoading();
    });
  });

  // Windows env names are case-insensitive, to mise too.
  test('refuses with CI spelled in lower case', () => {
    const { CI, ...rest } = env;
    const result = hook(runTask('ask'), { ...rest, ci: 'true' });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(denied('asks for confirmation'));
  });

  test.each([
    ['a confirm message that only renders when asked', 'templated'],
    ['a task that doesn\'t exist', 'no-such-task']
  ])('refuses when the dry run fails: %s', (_, task) => {
    const result = hook(runTask(task));

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(denied('dry run of'));
  });

  test.each([
    ['input that is not JSON', 'not json'],
    ['a call without a task', JSON.stringify({ tool_input: {} })],
    ['a call without input', JSON.stringify({ tool_input: null })],
    ['arguments that are not a list', JSON.stringify({ tool_input: { task: 'plain', args: 'x' } })]
  ])('refuses %s', (_, input) => {
    const result = hook(input);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(denied('Couldn\'t read'));
  });

  test.each([
    ['a double quote', ['x" & node scripts/release-firefox.js']],
    ['a variable', ['%PATH%']]
  ])('refuses an argument with %s, which cmd.exe would act on', (_, args) => {
    const result = hook(runTask('plain', args));

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(denied('can\'t contain'));
  });

  test('refuses, with a reason, a call it fails to check', () => {
    const result = hook(runTask('plain\0'));

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(denied('Couldn\'t check'));
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
    ['a call without arguments', JSON.stringify({ tool_input: { task: 'plain' } })],
    // A dry run prints the command; only a failed one is read for a reason.
    ['a command that mentions confirmation and trust', runTask('wordy')]
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
    'mcp__Mise__run_task',
    'mcp__claude_ai_Mise__run_task',
    'mcp__mise2__run_task',
    'mcp__localmise__run_task',
    'mcp__myMise__run_task',
    // Broad on purpose: a server that only contains the word has its calls
    // refused, which fails closed, rather than a mise server going unguarded.
    'mcp__promise__run_task',
    'mcp__plugin_mise_mise__run_task'
  ])('runs the hook before %s', (tool) => {
    expect(runs(tool)).toBeDefined();
  });

  test.each([
    'mcp__mise__list_tasks',
    'mcp__other__run_task',
    'mcp__mise__run_task_x',
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

    // CLAUDE_PROJECT_DIR is the real repo here, which has no task that asks, so
    // this uses an argument refusal, which comes before the dry run.
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
