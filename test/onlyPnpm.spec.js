import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.resolve(__dirname, '../scripts/only-pnpm.js');

function run(userAgent) {
  const env = { ...process.env };
  delete env.npm_config_user_agent;
  if (userAgent !== undefined) env.npm_config_user_agent = userAgent;
  return spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' });
}

test('the preinstall hook runs the guard', () => {
  expect(require('../package.json').scripts.preinstall).toBe('node scripts/only-pnpm.js');
});

test('pnpm passes', () => {
  expect(run('pnpm/12.18.0 npm/? node/v26.13.0 win32 x64').status).toBe(0);
});

test.each([
  ['npm', 'npm/11.6.2 node/v26.13.0 win32 x64 workspaces/false'],
  ['yarn', 'yarn/1.22.22 npm/? node/v26.13.0 linux x64'],
  ['bun', 'bun/1.3.1 npm/? node/v26.13.0 linux x64'],
])('%s is refused, by name', (name, userAgent) => {
  const result = run(userAgent);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`not ${name}`);
});

// Matches only-allow: with no user agent there is nothing to judge.
test('no user agent passes', () => {
  expect(run(undefined).status).toBe(0);
});

// npm runs the root preinstall only after the dependencies' install scripts,
// so the guard above is too late for npm; engines.npm refuses it up front.
// A dependency-free copy of our engines and .npmrc lets npm reach that check
// offline. npm comes from PATH; pnpm's npm_config_* would leak into it.
describe('npm install', () => {
  const ROOT = path.resolve(__dirname, '..');
  const { engines } = require('../package.json');

  function npmInstall(projectEngines) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'only-pnpm-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'),
        JSON.stringify({ name: 'probe', version: '1.0.0', engines: projectEngines }));
      fs.copyFileSync(path.join(ROOT, '.npmrc'), path.join(dir, '.npmrc'));
      const env = Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => !/^npm_/i.test(key)));
      // A shell finds npm.cmd on Windows; the command is a constant.
      const result = spawnSync('npm install --offline --ignore-scripts --no-audit --no-fund',
        { cwd: dir, env, encoding: 'utf8', shell: true });
      return { ...result, installed: fs.existsSync(path.join(dir, 'package-lock.json')) };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  test('is refused by engines.npm before it installs anything', () => {
    const result = npmInstall(engines);

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('EBADENGINE');
    expect(result.installed).toBe(false);
  }, 30000);

  test('goes through without engines.npm, so that key is what refuses it', () => {
    const { npm, ...rest } = engines;
    const result = npmInstall(rest);

    expect(result.stdout + result.stderr).not.toContain('EBADENGINE');
    expect(result.status).toBe(0);
  }, 30000);
});
