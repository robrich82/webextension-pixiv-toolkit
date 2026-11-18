/**
 * pnpm is pinned twice: mise.toml installs it and `packageManager` is what pnpm
 * itself runs. Renovate bumps both in one PR and relocks mise.lock there, and CI
 * installs with `mise install --locked`, which fails on a version mise.lock
 * doesn't have. This catches a hand-edited pin before CI does.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// Only the flat `name = "version"` lines of mise.toml's [tools] table.
const tools = Object.fromEntries(
  [...read('mise.toml').split(/^\[tools\]$/m)[1].split(/^\[/m)[0].matchAll(/^([\w-]+) = "([^"]+)"$/gm)]
    .map(([, name, version]) => [name, version])
);

// mise.lock records each tool as `[[tools.<name>]]` followed by `version = "…"`.
// Kept as a list: a second entry for one tool (another backend) is the failure.
const locked = [...read('mise.lock').matchAll(/^\[\[tools\.([\w-]+)\]\]\nversion = "([^"]+)"$/gm)]
  .map(([, name, version]) => `${name}@${version}`);

test('mise.toml pins node and pnpm', () => {
  expect(Object.keys(tools).sort()).toEqual(['node', 'pnpm']);
});

test('the pnpm in mise.toml is the one `packageManager` names', () => {
  const { packageManager } = JSON.parse(read('package.json'));

  expect(packageManager).toMatch(/^pnpm@[^+]+\+sha512\.[0-9a-f]{128}$/);
  expect(packageManager.slice('pnpm@'.length).split('+')[0]).toBe(tools.pnpm);
});

test('mise.lock locks exactly the versions mise.toml pins, once each', () => {
  expect(read('mise.lock').match(/^\[\[tools\./gm)).toHaveLength(locked.length);
  expect(locked.sort()).toEqual(Object.entries(tools).map(([name, version]) => `${name}@${version}`).sort());
});

test('mise.lock has a linux-x64 download for every tool, for CI', () => {
  for (const name of Object.keys(tools)) {
    expect(read('mise.lock')).toMatch(
      new RegExp(`^\\[tools\\.${name}\\."platforms\\.linux-x64"\\]\\nchecksum = "sha256:[0-9a-f]{64}"$`, 'm')
    );
  }
});
