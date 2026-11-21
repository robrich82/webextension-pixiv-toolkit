/**
 * Decides which CI jobs a pull request needs from the files it changes, and
 * prints them as `job=true|false` lines for $GITHUB_OUTPUT. A path no rule
 * matches runs every job, so a new directory can't silently skip CI.
 * test/ciChanges.spec.js checks the rules against what the E2E suites import
 * and read. Runs on the runner's own Node, before any install: no dependencies.
 *
 *   node scripts/ciChanges.mjs         # jobs for HEAD^1..HEAD
 *   node scripts/ciChanges.mjs --all   # every job
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const JOBS = ['test', 'build', 'e2e_chrome', 'e2e_firefox'];
const E2E = ['e2e_chrome', 'e2e_firefox'];

// [pattern, jobs whose inputs it is]; the first match wins.
const RULES = [
  // The E2E suites read the fixtures and import the probe helpers.
  [/^test\/(fixtures|helpers)\//, ['test', ...E2E]],
  // Read by people and agents only. Markdown under src/ can ship, so it isn't here.
  [/^(docs|\.claude|\.cursor|\.agents)(\/|$)/, []],
  [/^(?!src\/).*\.md$/, []],
  [/^(\.mcp\.json|\.editorconfig|\.gitignore|jsconfig\.json)$/, []],
  // Validated by its own workflow.
  [/^(renovate\.json|\.github\/workflows\/renovate-config\.yml)$/, []],
  [/^(test\/|vitest\.config\.mjs$)/, ['test']],
  // The Firefox harness serves pixiv through the Chromium suite's routes.
  [/^e2e\/fakePixivRoutes\.js$/, E2E],
  [/^(e2e\/|playwright\.config\.js$)/, ['e2e_chrome']],
  [/^e2e-firefox\//, ['e2e_firefox']]
];

/** Which jobs the changed `paths` (repo-relative, forward slashes) need. */
export function jobsFor(paths) {
  const needed = new Set();
  for (const file of paths) {
    const rule = RULES.find(([pattern]) => pattern.test(file));
    for (const job of rule ? rule[1] : JOBS) needed.add(job);
  }
  // The E2E jobs test the build job's artifacts.
  if (E2E.some((job) => needed.has(job))) needed.add('build');
  return Object.fromEntries(JOBS.map((job) => [job, needed.has(job)]));
}

// A pull request checks out a merge commit whose first parent is the base
// branch, so HEAD^1..HEAD is everything the PR changes. --no-renames lists a
// moved file's old path too, so moving a file out of src/ still counts as code.
function changedFiles() {
  return execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', 'HEAD^1', 'HEAD'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let jobs;
  if (process.argv.includes('--all')) {
    jobs = Object.fromEntries(JOBS.map((job) => [job, true]));
  } else {
    const files = changedFiles();
    console.error(`Changed files:\n${files.join('\n')}`);
    jobs = jobsFor(files);
  }
  for (const [job, run] of Object.entries(jobs)) console.log(`${job}=${run}`);
}
