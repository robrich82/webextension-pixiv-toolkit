/**
 * The `[tasks]` in mise.toml, checked through the real mise that CI and local
 * development run them with. Dry runs (-n) print each command to stderr
 * without running it; --no-deps keeps them from running `pnpm install`.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
// mise answers `confirm` itself when MISE_YES or CI is set (CI to anything
// but `false`), and colours its output on CI runners, which the parsing below
// can't read.
const { MISE_YES, CI, ...rest } = process.env;
const env = { ...rest, NO_COLOR: '1' };

function mise(...args) {
  const result = spawnSync('mise', args, { cwd: ROOT, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw new Error(`Couldn't run mise (${result.error.message}); install it, see docs/toolchain.md.`);
  return result;
}

/** The commands a dry run of `args` would run, in order. */
function dryRun(...args) {
  const { status, stderr } = mise('run', '-n', '--no-deps', ...args);
  expect(status, stderr).toBe(0);
  return [...stderr.matchAll(/^\[([^\]]+)\] \$ (.+)$/gm)].map(([, task, command]) => `${task}: ${command}`);
}

const tasks = JSON.parse(mise('tasks', 'ls', '--json').stdout);

describe.concurrent('mise tasks', { timeout: 30000 }, () => {
  test('mise validates every task', () => {
    const { status, stdout, stderr } = mise('tasks', 'validate');
    expect(status, stdout + stderr).toBe(0);
  });

  test('every task has a description, for `mise tasks ls`', () => {
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.filter(({ description }) => !description).map(({ name }) => name)).toEqual([]);
  });

  test('every command runs a file that exists', () => {
    const missing = tasks.flatMap(({ name, run }) => run.map((command) => {
      const script = command.match(/^node (?:--\S+ )*(scripts\/\S+)/)?.[1];
      const bin = command.match(/^pnpm exec (\S+)/)?.[1];
      const file = script ?? (bin && `node_modules/.bin/${bin}`);
      return file && !fs.existsSync(path.join(ROOT, file)) ? `${name}: ${file}` : null;
    })).filter(Boolean);
    expect(missing).toEqual([]);
  });

  test('the E2E tasks build what they test first', () => {
    expect(dryRun('test:e2e')).toEqual(['build: node scripts/build.mjs', 'test:e2e: pnpm exec playwright test']);
    expect(dryRun('test:e2e:firefox')).toEqual([
      'build:firefox: node scripts/build.mjs --platform=firefox',
      'test:e2e:firefox: node --test --test-reporter=spec "e2e-firefox/*.test.mjs"'
    ]);
  });

  test('--skip-deps tests the build already in dist/, as CI does with its artifact', () => {
    expect(dryRun('--skip-deps', 'test:e2e')).toEqual(['test:e2e: pnpm exec playwright test']);
  });

  test('arguments after the task name reach its command', () => {
    expect(dryRun('test', '--coverage.enabled=false', 'test/NameFormatter.spec.js')).toEqual([
      'test: pnpm exec vitest run --coverage.enabled=false test/NameFormatter.spec.js'
    ]);
  });

  // AMO signs a version once, so an unattended `mise run` must not start one.
  test('release:firefox refuses to start without a terminal or --yes', () => {
    const { status, stderr } = mise('run', '-n', '--no-deps', 'release:firefox');
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/requires confirmation/);
    expect(stderr).not.toMatch(/\$ node scripts\/release-firefox\.js/);
  });
});
