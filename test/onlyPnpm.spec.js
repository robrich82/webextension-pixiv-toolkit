import { spawnSync } from 'child_process';
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
