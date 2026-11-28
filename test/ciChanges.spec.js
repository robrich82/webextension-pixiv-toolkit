/**
 * scripts/ciChanges.mjs decides which CI jobs a pull request runs. These
 * check its rules, that they keep up with what each suite imports and reads,
 * that ci.yml wires each job to its output, and the CLI against a real merge
 * commit like the one CI checks out.
 */
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JOBS, jobsFor } from '../scripts/ciChanges.mjs';

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/ciChanges.mjs');
const TRACKED = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);

/** The jobs `jobsFor` turns on, for terse expectations. */
const on = (paths) => Object.entries(jobsFor(paths)).filter(([, run]) => run).map(([job]) => job);

describe('jobsFor', () => {
  test.each([
    ['docs', ['docs/testing.md', 'docs/img/shot.png'], []],
    ['markdown outside src/', ['README.md', '.github/pull_request_template.md'], []],
    ['agent config', ['.claude/settings.local.json', '.cursor/rules/x.mdc', '.agents', '.mcp.json'], []],
    ['editor config', ['.editorconfig', '.gitignore', 'jsconfig.json'], []],
    ['Renovate config', ['renovate.json', '.github/workflows/renovate-config.yml'], []],
    ['nothing', [], []],
    ['a unit test', ['test/NameFormatter.spec.js'], ['test']],
    ['markdown among the unit tests', ['test/components/README.md'], ['test']],
    ['the Vitest config', ['vite.config.mjs'], ['test']],
    ['the related-tests hook', ['.claude/hooks/related-tests.js'], ['test']],
    ['another hook', ['.claude/hooks/other.js'], ['test']],
    ['the Claude settings', ['.claude/settings.json'], ['test']],
    ['a test fixture', ['test/fixtures/pixiv/illust.json'], JOBS],
    ['the fixtures README', ['test/fixtures/README.md'], JOBS],
    ['a probe helper', ['test/helpers/probeGif.mjs'], JOBS],
    ['a Chromium E2E test', ['e2e/illust.e2e.js'], ['test', 'build', 'e2e_chrome']],
    ['markdown in an E2E suite', ['e2e/README.md'], ['test', 'build', 'e2e_chrome']],
    ['the Playwright config', ['playwright.config.js'], ['test', 'build', 'e2e_chrome']],
    ['the shared pixiv routes', ['e2e/fakePixivRoutes.js'], JOBS],
    ['a Firefox E2E test', ['e2e-firefox/downloads.test.mjs'], ['test', 'build', 'e2e_firefox']],
    ['docs plus a Firefox E2E test', ['docs/testing.md', 'e2e-firefox/bidi.mjs'], ['test', 'build', 'e2e_firefox']],
    ['source', ['src/modules/Util/index.js'], JOBS],
    ['shipped markdown', ['src/statics/help.md'], JOBS],
    ['a name that only starts like docs', ['docs-gen/build.js', '.claude-plugin/x.js'], JOBS],
    ['the rules themselves', ['scripts/ciChanges.mjs'], JOBS],
    ['the CI workflow', ['.github/workflows/ci.yml'], JOBS],
    ['the setup action', ['.github/actions/setup/action.yml'], JOBS],
    ['the lockfile', ['pnpm-lock.yaml'], JOBS],
    ['a path no rule knows', ['newdir/thing.js'], JOBS]
  ])('%s', (_, paths, expected) => {
    expect(on(paths)).toEqual(expected);
  });
});

/** A repo-relative path, forward slashes. */
const relative = (absolute) => path.relative(ROOT, absolute).split(path.sep).join('/');

/** Tracked files at `target`: the file itself, an import without its extension, or everything under a directory. */
function trackedAt(target) {
  const file = ['', '.js', '.mjs', '.cjs'].map((ext) => target + ext).find((candidate) => TRACKED.includes(candidate));
  return file ? [file] : TRACKED.filter((tracked) => tracked.startsWith(`${target}/`));
}

/**
 * Tracked files `file` references: relative string literals (a template
 * literal up to its first `${`), and path.join/path.resolve from __dirname
 * (its leading literal arguments). A reference that names nothing falls back to
 * its directory when it may be a prefix of the real path.
 */
function referencedBy(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const refs = [];
  for (const [, quote, spec, end] of source.matchAll(/(['"`])(\.\.?\/[^'"`\n]*?)(['"`]|\$\{)/g)) {
    if (end === quote || end === '${') refs.push([path.resolve(ROOT, path.dirname(file), spec), end === '${']);
  }
  for (const [, args] of source.matchAll(/path\.(?:join|resolve)\(\s*(?:__dirname|import\.meta\.dirname)((?:\s*,\s*(['"])[^'"\n]*\2)*)/g)) {
    const segments = [...args.matchAll(/(['"])([^'"\n]*)\1/g)].map(([, , segment]) => segment);
    refs.push([path.resolve(ROOT, path.dirname(file), ...segments), true]);
  }
  return refs.flatMap(([absolute, prefix]) => {
    const target = relative(absolute);
    if (target.startsWith('..') || target.startsWith('dist/') || target === 'dist') return [];
    const found = trackedAt(target);
    return found.length || !prefix ? found : trackedAt(relative(path.dirname(absolute)));
  });
}

/** Every tracked file reachable from `start`, following references through JS files. */
function reachableFrom(start) {
  const seen = new Set();
  const queue = [...start];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (/\.[cm]?js$/.test(file)) queue.push(...referencedBy(file));
  }
  return [...seen];
}

describe.each([
  ['the Chromium E2E suite', 'e2e_chrome', ['e2e/', 'playwright.config.js'], ['test/helpers/probeGif.mjs', 'test/fixtures/']],
  ['the Firefox E2E suite', 'e2e_firefox', ['e2e-firefox/'], ['e2e/fakePixivRoutes.js', 'test/helpers/probeVideo.mjs', 'test/fixtures/']],
  ['the unit suite', 'test', ['test/', 'vite.config.mjs'], ['src/', 'scripts/ciChanges.mjs']]
])('%s', (_, job, roots, expected) => {
  const start = TRACKED.filter((file) => roots.some((root) => root.endsWith('/') ? file.startsWith(root) : file === root));
  const reached = reachableFrom(start);

  test('finds the files it is known to reach', () => {
    for (const prefix of expected) expect(reached.some((file) => file.startsWith(prefix))).toBe(true);
  });

  test(`a change to anything it reaches runs ${job}`, () => {
    expect(reached.filter((file) => !jobsFor([file])[job])).toEqual([]);
  });
});

describe('ci.yml', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n');
  // A job's key line: `  name:`, maybe quoted, maybe with a trailing comment.
  const KEY = / {2}['"]?([\w-]+)['"]?:[ \t]*(?:#.*)?$/;
  const jobs = Object.fromEntries(workflow.split('\njobs:\n')[1].split(new RegExp(`\\n(?=${KEY.source.slice(0, -1)}\\n)`))
    .filter((block) => new RegExp(`^${KEY.source}`, 'm').test(block))
    .map((block) => [block.match(new RegExp(`^${KEY.source}`, 'm'))[1], block]));
  const needs = (id) => {
    const [, list] = jobs[id].match(/^ {4}needs: (.+)$/m) ?? [];
    return list ? list.replace(/[[\]]/g, '').split(',').map((name) => name.trim()) : [];
  };

  test('the changes job outputs every job, in order', () => {
    const outputs = [...jobs.changes.matchAll(/^ {6}(\w+): \$\{\{ steps\.changes\.outputs\.(\w+) \}\}$/gm)];
    expect(outputs.map(([, name]) => name)).toEqual(JOBS);
    expect(outputs.every(([, name, output]) => name === output)).toBe(true);
  });

  test.each(JOBS)('%s runs unless its output is exactly false', (job) => {
    const id = job.replace('_', '-');
    expect(needs(id)).toContain('changes');
    expect(jobs[id]).toMatch(new RegExp(`^ {4}if: needs\\.changes\\.outputs\\.${job} != 'false'$`, 'm'));
  });

  test('the E2E jobs need build, whose artifacts they test', () => {
    expect(needs('e2e-chrome')).toContain('build');
    expect(needs('e2e-firefox')).toContain('build');
  });

  test('the ci gate needs every other job', () => {
    expect(needs('ci').sort()).toEqual(Object.keys(jobs).filter((id) => id !== 'ci').sort());
  });

  test('the ci gate always runs, on every result', () => {
    expect(jobs.ci).toMatch(/^ {4}if: always\(\)$/m);
    expect(jobs.ci).toMatch(/^ {10}RESULTS: \$\{\{ join\(needs\.\*\.result, ' '\) \}\}$/m);
  });

  const hasSh = spawnSync('sh', ['-c', 'true']).status === 0;
  test.skipIf(!hasSh).each([
    ['success skipped skipped skipped success', 0],
    ['success skipped skipped skipped skipped', 0],
    ['success success failure skipped skipped', 1],
    ['success success success cancelled success', 1],
    ['failure skipped skipped skipped skipped', 1]
  ])('the gate given "%s" exits %i', (results, status) => {
    const [, script] = jobs.ci.match(/run: \|\n((?: {10}.*\n?)+)/);
    const gate = spawnSync('sh', ['-ec', script.replace(/^ {10}/gm, '')], { env: { ...process.env, RESULTS: results } });
    expect(gate.status).toBe(status);
  });
});

describe('the CLI', () => {
  let repo;
  // Without GIT_DIR and the like, which a git hook running the tests would
  // pass on, so these commands stay inside the temp repo.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)));
  const git = (...args) => execFileSync('git', [
    '-c', 'user.name=ci', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args
  ], { cwd: repo, env, encoding: 'utf8', stdio: 'pipe' });
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
  };
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, env, encoding: 'utf8' });

  /** Commit `change` on a branch, move main on with a src/ change, and merge the branch like a PR merge ref. */
  function mergePullRequest(change) {
    write('src/index.js', '1');
    write('docs/a.md', '1');
    git('add', '-A');
    git('commit', '-m', 'base');
    git('checkout', '-q', '-b', 'pr');
    change();
    git('add', '-A');
    git('commit', '-m', 'pr');
    git('checkout', '-q', 'main');
    write('src/index.js', '2');
    git('commit', '-am', 'main moves on');
    git('merge', '--no-ff', '-m', 'merge', 'pr');
  }

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-ci-changes-'));
    git('init', '-q', '-b', 'main');
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 });
  });

  test('a docs-only pull request runs nothing, whatever the base branch changed', () => {
    mergePullRequest(() => write('docs/a.md', '2'));
    expect(run().stdout).toBe('test=false\nbuild=false\ne2e_chrome=false\ne2e_firefox=false\n');
  });

  test('several files, one with spaces and accents in its name, combine their jobs', () => {
    mergePullRequest(() => {
      write('docs/a b é.md', '1');
      write('e2e-firefox/x.mjs', '1');
    });
    expect(run().stdout).toBe('test=true\nbuild=true\ne2e_chrome=false\ne2e_firefox=true\n');
  });

  test('moving a source file into docs/ runs everything', () => {
    mergePullRequest(() => git('mv', 'src/index.js', 'docs/index.js'));
    expect(run().stdout).toBe('test=true\nbuild=true\ne2e_chrome=true\ne2e_firefox=true\n');
  });

  test('--all runs everything without looking at git', () => {
    expect(run('--all').stdout).toBe('test=true\nbuild=true\ne2e_chrome=true\ne2e_firefox=true\n');
  });

  test('runs everything when HEAD is not a merge commit', () => {
    write('docs/a.md', '1');
    git('add', '-A');
    git('commit', '-m', 'base');
    write('docs/a.md', '2');
    git('commit', '-am', 'docs only, but not a merge');
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('test=true\nbuild=true\ne2e_chrome=true\ne2e_firefox=true\n');
    expect(result.stderr).toMatch(/not a merge commit/);
  });
});
