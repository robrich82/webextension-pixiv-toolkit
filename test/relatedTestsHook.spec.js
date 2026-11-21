/**
 * .claude/hooks/related-tests.js runs the specs related to each file Claude
 * edits. `vitest related` follows imports only, so the hook names the specs
 * that read their inputs with fs. These check that table and run the hook.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { READ_BY, relatedArgs } from '../.claude/hooks/related-tests.js';

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, '.claude/hooks/related-tests.js');

describe('relatedArgs', () => {
  test.each([
    ['source', 'src/modules/Util/index.js', ['src/modules/Util/index.js']],
    ['a component', 'src/popup_page/App.vue', ['src/popup_page/App.vue']],
    ['an imported JSON file', 'src/statics/histories.json', ['src/statics/histories.json']],
    ['a spec', 'test/NameFormatter.spec.js', ['test/NameFormatter.spec.js']],
    ['a fixture', 'test/fixtures/pixiv/illust.json', ['test/fixtures/pixiv/illust.json']],
    ['a script', 'scripts/ciChanges.mjs', ['scripts/ciChanges.mjs']],
    ['a locale', 'src/statics/_locales/zh_CN/messages.json', ['src/statics/_locales/zh_CN/messages.json', 'test/i18nKeys.spec.js']],
    ['a change history', 'src/statics/HISTORY_en-US', ['test/components/ChangeLog.spec.js']],
    ['the manifest', 'src/statics/manifest.json', ['src/statics/manifest.json', 'test/manifest.spec.js', 'test/releaseFirefox.spec.js']],
    ['package.json', 'package.json', ['test/engines.spec.js', 'test/manifest.spec.js', 'test/toolchainPins.spec.js']],
    ['the mise lockfile', 'mise.lock', ['test/toolchainPins.spec.js']],
    ['docs', 'docs/testing.md', []],
    ['markdown under test/', 'test/fixtures/README.md', []],
    ['agent config', '.claude/settings.json', []]
  ])('%s', (_, file, expected) => {
    expect(relatedArgs(file)).toEqual(expected);
  });
});

test.each([...new Set(READ_BY.flatMap(([, specs]) => specs))])('%s exists', (spec) => {
  expect(fs.existsSync(path.join(ROOT, spec))).toBe(true);
});

describe('the hook', () => {
  const hook = (input) => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 60000 });
  const edit = (file) => JSON.stringify({ tool_input: { file_path: path.join(ROOT, file) } });

  test.each([
    ['input that is not JSON', 'not json'],
    ['a tool call without a file', JSON.stringify({ tool_input: {} })],
    ['a file no spec depends on', edit('docs/testing.md')],
    ['a file outside any checkout', JSON.stringify({ tool_input: { file_path: path.join(path.parse(ROOT).root, 'nowhere.js') } })]
  ])('does nothing for %s', (_, input) => {
    const result = hook(input);

    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toBe('');
  });

  test('runs the specs that read a locale, and passes on this checkout', () => {
    const result = hook(edit('src/statics/_locales/en/messages.json'));

    expect(result.stderr).not.toMatch(/failed|did not finish/);
    expect(result.status).toBe(0);
  }, 60000);
});
