/**
 * pnpm is pinned twice: mise.toml installs it and `packageManager` is what pnpm
 * itself runs. CI installs with `mise install --locked`, which fails on a
 * version mise.lock doesn't have. This catches a hand-edited pin before CI does.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

// Splits a TOML file into `[header]` → body; enough for these two flat files.
const tables = (text) => text.split(/^(?=\[)/m).map((chunk) => {
  const [header, ...body] = chunk.split('\n');
  return { header, body: body.join('\n') };
});

const toolsTable = tables(read('mise.toml')).find(({ header }) => header === '[tools]');
const toolLines = (toolsTable?.body ?? '').split('\n').filter((line) => line.trim() && !line.startsWith('#'));
const tools = toolLines.map((line) => line.match(/^([\w-]+) = "([^"]+)"$/));

// Each `[[tools.<name>]]` entry, wherever its `version` line falls.
const lockEntries = tables(read('mise.lock')).filter(({ header }) => header.startsWith('[[tools.'));
const locked = lockEntries.map(({ header, body }) =>
  `${header.slice('[[tools.'.length, -2)}@${body.match(/^version = "([^"]+)"$/m)?.[1]}`
);

test('every mise.toml [tools] line is a flat `name = "version"` pin', () => {
  expect(toolLines.length).toBeGreaterThan(0);
  expect(toolLines.filter((_, i) => !tools[i])).toEqual([]);
});

test('the pnpm in mise.toml is the one `packageManager` names, hash included', () => {
  const { packageManager } = JSON.parse(read('package.json'));
  const pnpm = tools.find((match) => match?.[1] === 'pnpm')?.[2];

  expect(packageManager).toMatch(/^pnpm@[^+]+\+sha512\.[0-9a-f]{128}$/);
  expect(packageManager.slice('pnpm@'.length).split('+')[0]).toBe(pnpm);
});

test('mise.lock locks exactly the versions mise.toml pins, once each', () => {
  expect(locked.sort()).toEqual(tools.map((match) => `${match?.[1]}@${match?.[2]}`).sort());
});

test('mise.lock has a linux-x64 url and checksum for every tool, for CI', () => {
  for (const match of tools) {
    const platform = tables(read('mise.lock')).find(({ header }) => header === `[tools.${match?.[1]}."platforms.linux-x64"]`);

    expect(platform?.body).toMatch(/^url = "https:\/\/\S+"$/m);
    expect(platform?.body).toMatch(/^checksum = "sha256:[0-9a-f]{64}"$/m);
  }
});
