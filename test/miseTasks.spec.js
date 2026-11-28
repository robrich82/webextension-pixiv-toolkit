/**
 * The `[tasks]` in mise.toml, checked through the real mise that CI and local
 * development run them with. Dry runs (-n) print each command to stderr
 * without running it.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const NO_CONFIG = path.join(ROOT, '.no-such-mise-config.toml');

// Only mise.toml counts: no global, system or parent-directory config, and
// none of the settings that change what a dry run prints or whether `confirm`
// is answered (CI and MISE_YES answer it; MISE_YES=false also overrides a
// global `yes = true`).
const { CI, MISE_QUIET, MISE_SILENT, MISE_TASK_SKIP_DEPENDS, ...inherited } = process.env;
const env = {
  ...inherited,
  MISE_GLOBAL_CONFIG_FILE: NO_CONFIG,
  MISE_SYSTEM_CONFIG_FILE: NO_CONFIG,
  MISE_CEILING_PATHS: path.dirname(ROOT),
  MISE_YES: 'false',
  MISE_TASK_OUTPUT: 'prefix',
  // Without a terminal mise cuts each echoed command at 80 columns, unless it
  // detects an AI coding agent, so a local run inside one wouldn't catch it.
  MISE_TASK_SHOW_FULL_CMD: 'true',
  NO_COLOR: '1'
};

function mise(...args) {
  const result = spawnSync('mise', args, { cwd: ROOT, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
  if (result.error) throw new Error(`Couldn't run mise (${result.error.message}); install it from https://mise.jdx.dev.`);
  return result;
}

/**
 * The commands a dry run of `args` would run, in order. mise on Linux
 * single-quotes some task arguments in the echo (`'--a=b'`) and on Windows it
 * doesn't, so the quotes are dropped.
 */
function dryRun(...args) {
  const { status, stderr } = mise('run', '-n', ...args);
  expect(status, stderr).toBe(0);
  return [...stderr.matchAll(/^\[([^\]]+)\] \$ (.+)$/gm)]
    .map(([, task, command]) => `${task}: ${command.replace(/'([^']*)'/g, '$1')}`);
}

const listed = mise('tasks', 'ls', '--json');
if (listed.status !== 0) throw new Error(`mise tasks ls failed:\n${listed.stderr}`);
const tasks = JSON.parse(listed.stdout);

describe('mise tasks', { timeout: 30000 }, () => {
  test('mise validates every task', () => {
    const { status, stdout, stderr } = mise('tasks', 'validate');
    expect(status, stdout + stderr).toBe(0);
  });

  test('every task has a description, for `mise tasks ls`', () => {
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.filter(({ description }) => !description).map(({ name }) => name)).toEqual([]);
  });

  test('every script or package binary a command runs exists', () => {
    const missing = tasks.flatMap(({ name, run }) => run.map((command) => {
      const script = command.match(/^node (?:--\S+ )*(scripts\/\S+)/)?.[1];
      const bin = command.match(/^pnpm exec (\S+)/)?.[1];
      const file = script ?? (bin && `node_modules/.bin/${bin}`);
      return file && !fs.existsSync(path.join(ROOT, file)) ? `${name}: ${file}` : null;
    })).filter(Boolean);
    expect(missing).toEqual([]);
  });

  // release:firefox is left out: it never gets as far as its command (below).
  test.each([
    ['dev', ['dev: node scripts/build.mjs --watch']],
    ['dev:firefox', ['dev:firefox: node scripts/build.mjs --platform=firefox --watch']],
    ['build', ['build: node scripts/build.mjs']],
    ['build:firefox', ['build:firefox: node scripts/build.mjs --platform=firefox']],
    ['test', ['test: pnpm exec vp test run']],
    // The E2E tasks build what they test first.
    ['test:e2e', ['build: node scripts/build.mjs', 'test:e2e: pnpm exec playwright test']],
    ['test:e2e:firefox', [
      'build:firefox: node scripts/build.mjs --platform=firefox',
      'test:e2e:firefox: node --test --test-reporter=spec "e2e-firefox/*.test.mjs"'
    ]],
    ['audit', ['audit: pnpm audit --audit-level=moderate']],
    ['package:chrome', ['package:chrome: node scripts/package-chrome.mjs']]
  ])('%s runs exactly its commands', (task, commands) => {
    expect(dryRun(task)).toEqual(commands);
  });

  test('every task but release:firefox is in the table above', () => {
    expect(tasks.map(({ name }) => name).sort()).toEqual([
      'audit', 'build', 'build:firefox', 'dev', 'dev:firefox', 'package:chrome', 'release:firefox',
      'test', 'test:e2e', 'test:e2e:firefox'
    ]);
  });

  test('--skip-deps tests the build already in dist/', () => {
    expect(dryRun('--skip-deps', 'test:e2e')).toEqual(['test:e2e: pnpm exec playwright test']);
  });

  test('arguments after the task name reach its command', () => {
    expect(dryRun('test', '--coverage.enabled=false', 'test/NameFormatter.spec.js')).toEqual([
      'test: pnpm exec vp test run --coverage.enabled=false test/NameFormatter.spec.js'
    ]);
  });

  // scripts/build.mjs's parseArgs would reject a `--` that reached it.
  test('a `--` before the arguments is dropped, not passed on', () => {
    expect(dryRun('build', '--', '--out-dir=x')).toEqual(['build: node scripts/build.mjs --out-dir=x']);
  });

  // AMO signs a version once, so a run with nobody to answer must not start one.
  test('release:firefox refuses to start without a terminal or --yes', () => {
    const { status, stderr } = mise('run', '-n', 'release:firefox');
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/requires confirmation/);
    expect(stderr).not.toMatch(/\$ node scripts\/release-firefox\.js/);
  });
});
