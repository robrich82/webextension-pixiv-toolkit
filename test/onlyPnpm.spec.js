import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import pkg from '../package.json';

const SCRIPT = path.resolve(__dirname, '../scripts/only-pnpm.js');

function run(userAgent) {
  // Case-insensitive: on Windows the inherited name can arrive upper-cased.
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => key.toLowerCase() !== 'npm_config_user_agent'));
  if (userAgent !== undefined) env.npm_config_user_agent = userAgent;
  return spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' });
}

test('the preinstall hook runs the guard', () => {
  expect(pkg.scripts.preinstall).toBe('node scripts/only-pnpm.js');
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

// npm runs the root preinstall too late, so engines.npm is what refuses it
// (docs/toolchain.md). The probe holds our engines and .npmrc and no
// dependencies, so npm reaches that check offline.
describe('npm install', () => {
  const NPMRC = path.resolve(__dirname, '../.npmrc');
  // The npm bundled with the Node running Jest, not whichever npm PATH finds.
  const NPM_CLI = path.join(path.dirname(process.execPath),
    process.platform === 'win32' ? '' : '../lib', 'node_modules/npm/bin/npm-cli.js');
  const { engines } = require('../package.json');

  function npmInstall(projectEngines) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'only-pnpm-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'),
        JSON.stringify({ name: 'probe', version: '1.0.0', engines: projectEngines }));
      fs.copyFileSync(NPMRC, path.join(dir, '.npmrc'));
      for (const name of ['user.npmrc', 'global.npmrc']) fs.writeFileSync(path.join(dir, name), '');
      // npm_config_* in the caller's env, and user/global npmrc files, outrank
      // or add to the project .npmrc (engine-strict=false, package-lock=false).
      const env = Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => !/^npm_/i.test(key)));
      env.npm_config_userconfig = path.join(dir, 'user.npmrc');
      env.npm_config_globalconfig = path.join(dir, 'global.npmrc');
      // spawnSync blocks Jest's own timeout, so it needs one of its own.
      const result = spawnSync(process.execPath, [NPM_CLI, 'install', '--offline'],
        { cwd: dir, env, encoding: 'utf8', timeout: 25000 });
      return {
        error: result.error,
        status: result.status,
        output: result.stdout + result.stderr,
        installed: fs.existsSync(path.join(dir, 'package-lock.json')),
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  }

  test('is refused by engines.npm before it installs anything', () => {
    const result = npmInstall(engines);

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('EBADENGINE');
    expect(result.output).toContain('please-use-pnpm');
    expect(result.installed).toBe(false);
  }, 30000);

  // EBADENGINE doesn't name the failing key; this shows it is engines.npm.
  test('goes through without engines.npm', () => {
    const { npm, ...rest } = engines;
    const result = npmInstall(rest);

    expect(result.error).toBeUndefined();
    expect(result.output).not.toContain('EBADENGINE');
    expect(result.status).toBe(0);
    expect(result.installed).toBe(true);
  }, 30000);
});
