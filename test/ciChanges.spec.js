/**
 * scripts/ciChanges.mjs decides which CI jobs a pull request runs. These
 * check its rules, that they keep up with what the E2E suites import and
 * read, and the CLI against a real merge commit like the one CI checks out.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JOBS, jobsFor } from '../scripts/ciChanges.mjs';

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/ciChanges.mjs');

/** The jobs `jobsFor` turns on, for terse expectations. */
const on = (paths) => Object.entries(jobsFor(paths)).filter(([, run]) => run).map(([job]) => job);

describe('jobsFor', () => {
  test.each([
    ['docs only', ['docs/testing.md', 'README.md', '.github/pull_request_template.md'], []],
    ['agent config', ['.claude/skills/x/SKILL.md', '.claude/settings.json', '.mcp.json'], []],
    ['Renovate config', ['renovate.json'], []],
    ['nothing', [], []],
    ['a unit test', ['test/NameFormatter.spec.js'], ['test']],
    ['a test fixture', ['test/fixtures/pixiv/illust.json'], JOBS],
    ['a probe helper', ['test/helpers/probeGif.mjs'], JOBS],
    ['a Chromium E2E test', ['e2e/illust.e2e.js'], ['build', 'e2e_chrome']],
    ['the shared pixiv routes', ['e2e/fakePixivRoutes.js'], ['build', 'e2e_chrome', 'e2e_firefox']],
    ['a Firefox E2E test', ['e2e-firefox/downloads.test.mjs'], ['build', 'e2e_firefox']],
    ['docs plus a Firefox E2E test', ['docs/testing.md', 'e2e-firefox/bidi.mjs'], ['build', 'e2e_firefox']],
    ['source', ['src/modules/Util/index.js'], JOBS],
    ['shipped markdown', ['src/statics/help.md'], JOBS],
    ['the CI workflow', ['.github/workflows/ci.yml'], JOBS],
    ['the setup action', ['.github/actions/setup/action.yml'], JOBS],
    ['the lockfile', ['pnpm-lock.yaml'], JOBS],
    ['a path no rule knows', ['newdir/thing.js'], JOBS]
  ])('%s', (_, paths, expected) => {
    expect(on(paths)).toEqual(expected);
  });
});

/** Repo files a suite file reaches outside its own directory, by import or path.join. */
function reachedFrom(file) {
  const source = fs.readFileSync(file, 'utf8');
  const targets = [...source.matchAll(/['"](\.\.\/[^'"]+)['"]/g)].map(([, spec]) => path.resolve(path.dirname(file), spec));
  for (const [, segments] of source.matchAll(/path\.join\((?:__dirname|import\.meta\.dirname),\s*'\.\.'((?:,\s*'[^']+')+)\)/g)) {
    targets.push(path.join(ROOT, ...[...segments.matchAll(/'([^']+)'/g)].map(([, segment]) => segment)));
  }
  return targets
    .map((target) => path.relative(ROOT, target).split(path.sep).join('/'))
    .filter((target) => !target.startsWith('dist/'))
    .flatMap((target) => fs.statSync(path.join(ROOT, target)).isDirectory()
      ? fs.readdirSync(path.join(ROOT, target), { recursive: true })
        .map((entry) => `${target}/${entry.split(path.sep).join('/')}`)
        .filter((entry) => fs.statSync(path.join(ROOT, entry)).isFile())
      : [target]);
}

describe.each([
  ['e2e', 'e2e_chrome'],
  ['e2e-firefox', 'e2e_firefox']
])('%s', (dir, job) => {
  const files = fs.readdirSync(path.join(ROOT, dir)).map((name) => `${dir}/${name}`);

  test(`its own files run ${job}`, () => {
    expect(files.filter((file) => !jobsFor([file])[job])).toEqual([]);
  });

  test(`everything it imports or reads from elsewhere runs ${job}`, () => {
    const reached = [...new Set(files.flatMap((file) => reachedFrom(path.join(ROOT, file))))];
    expect(reached.length).toBeGreaterThan(0);
    expect(reached.filter((file) => !jobsFor([file])[job])).toEqual([]);
  });
});

describe('the CLI', () => {
  let repo;
  const git = (...args) => execFileSync('git', [
    '-c', 'user.name=ci', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgsign=false', ...args
  ], { cwd: repo, encoding: 'utf8' });
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
  };
  const run = (...args) => execFileSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

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
    expect(run()).toBe('test=false\nbuild=false\ne2e_chrome=false\ne2e_firefox=false\n');
  });

  test('moving a source file into docs/ runs everything', () => {
    mergePullRequest(() => git('mv', 'src/index.js', 'docs/index.js'));
    expect(run()).toBe('test=true\nbuild=true\ne2e_chrome=true\ne2e_firefox=true\n');
  });

  test('--all runs everything without looking at git', () => {
    expect(run('--all')).toBe('test=true\nbuild=true\ne2e_chrome=true\ne2e_firefox=true\n');
  });

  test('fails when HEAD has no parent to compare with', () => {
    write('src/index.js', '1');
    git('add', '-A');
    git('commit', '-m', 'only');
    expect(() => run()).toThrow();
  });
});
