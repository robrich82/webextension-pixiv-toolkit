/**
 * engineStrict makes pnpm refuse to install a dependency whose own
 * `engines.node` excludes the running Node. CI only runs the mise.toml pin, so
 * a dependency bump that narrows the range (Babel 8 did) passes CI while
 * breaking installs elsewhere in the range package.json still claims.
 */
import fs from 'fs';
import path from 'path';
import semver from 'semver';

const ROOT = path.resolve(__dirname, '..');
const ours = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines.node;

// pnpm-lock.yaml records each package as `  name@version:` followed by an
// indented `    engines: {node: <range>, ...}` line.
const declared = new Map();
let pkg;
for (const line of fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8').split('\n')) {
  const key = line.match(/^ {2}'?([^\s'][^']*?)'?:$/);
  if (key) pkg = key[1];
  const node = line.match(/^ {4}engines: \{.*\bnode: (?:'([^']*)'|([^,}]+))/);
  if (node && pkg) declared.set(pkg, (node[1] ?? node[2]).trim());
}

test('the lockfile scan finds engines ranges', () => {
  expect(declared.size).toBeGreaterThan(100);
  expect(declared.get(`semver@${require('semver/package.json').version}`)).toBeDefined();
});

test(`every locked package admits all of engines.node (${ours})`, () => {
  const excluding = [...declared]
    .filter(([, range]) => semver.validRange(range) && !semver.subset(ours, range))
    .map(([name, range]) => `${name}: ${range}`);

  expect(excluding).toEqual([]);
});
