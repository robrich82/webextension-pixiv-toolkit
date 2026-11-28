/**
 * .claude/hooks/related-tests.js runs the specs related to each file Claude
 * edits. `vitest related` follows imports only, so the hook names the specs
 * that read their inputs with fs. These check that table and run the hook.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { READ_BY, relatedArgs } from '../.claude/hooks/related-tests.js';

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, '.claude/hooks/related-tests.js');

describe('relatedArgs', () => {
  test.each([
    ['source', 'src/modules/Util/index.js', ['src/modules/Util/index.js', 'test/i18nKeys.spec.js', 'test/components/vuetifyRegistration.spec.js']],
    ['a component', 'src/popup_page/App.vue', ['src/popup_page/App.vue', 'test/i18nKeys.spec.js', 'test/components/vuetifyRegistration.spec.js']],
    ['an imported JSON file', 'src/statics/histories.json', ['src/statics/histories.json']],
    ['a spec', 'test/NameFormatter.spec.js', ['test/NameFormatter.spec.js']],
    ['a fixture', 'test/fixtures/pixiv/illust.json', ['test/fixtures/pixiv/illust.json']],
    ['a script', 'scripts/ciChanges.mjs', ['scripts/ciChanges.mjs']],
    ['a locale', 'src/statics/_locales/zh_CN/messages.json', ['src/statics/_locales/zh_CN/messages.json', 'test/i18nKeys.spec.js']],
    ['a change history', 'src/statics/HISTORY_en-US', ['test/components/ChangeLog.spec.js']],
    ['the manifest', 'src/statics/manifest.json', ['src/statics/manifest.json', 'test/manifest.spec.js', 'test/releaseFirefox.spec.js']],
    ['package.json', 'package.json', ['test/components/ChangeLog.spec.js', 'test/engines.spec.js', 'test/manifest.spec.js', 'test/onlyPnpm.spec.js', 'test/toolchainPins.spec.js']],
    ['the script onlyPnpm spawns', 'scripts/only-pnpm.js', ['scripts/only-pnpm.js', 'test/onlyPnpm.spec.js']],
    ['the pnpm lockfile', 'pnpm-lock.yaml', ['test/engines.spec.js']],
    ['the mise lockfile', 'mise.lock', ['test/toolchainPins.spec.js']],
    ['the CI workflow', '.github/workflows/ci.yml', ['test/ciChanges.spec.js']],
    ['an E2E test', 'e2e/illust.e2e.js', ['test/ciChanges.spec.js']],
    ['this hook', '.claude/hooks/related-tests.js', ['test/relatedTestsHook.spec.js']],
    ['the settings reminder hook', '.claude/hooks/settings-migration-reminder.js', ['test/settingsMigrationReminder.spec.js']],
    ['docs', 'docs/testing.md', []],
    ['markdown under test/', 'test/fixtures/README.md', []],
    ['the MCP release guard', '.claude/hooks/no-mcp-release.js', ['test/noMcpRelease.spec.js']],
    ['the Claude settings', '.claude/settings.json', ['test/noMcpRelease.spec.js']],
    ['agent config', '.claude/agents/cross-browser-reviewer.md', []]
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
});

// A checkout whose Vitest is a stub that records its arguments, and fails when told to.
describe('the hook on a stub checkout', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-related-tests-'));
    fs.writeFileSync(path.join(root, 'vitest.config.mjs'), '');
    fs.mkdirSync(path.join(root, 'node_modules/vitest'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules/vitest/vitest.mjs'), `
      import fs from 'node:fs';
      fs.writeFileSync('argv.json', JSON.stringify(process.argv.slice(2)));
      if (fs.existsSync('fail')) {
        console.log('FAIL test/i18nKeys.spec.js');
        process.exit(1);
      }
    `);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const hook = (file) => spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_input: { file_path: path.join(root, file) } }),
    encoding: 'utf8',
    timeout: 30000
  });
  const argv = () => JSON.parse(fs.readFileSync(path.join(root, 'argv.json'), 'utf8'));

  test('passes the file and the specs that read it to vitest related', () => {
    const result = hook('src/statics/_locales/en/messages.json');

    expect(result.status).toBe(0);
    expect(argv()).toEqual([
      'related', 'src/statics/_locales/en/messages.json', 'test/i18nKeys.spec.js',
      '--run', '--coverage.enabled=false', '--passWithNoTests'
    ]);
  });

  test('passes only the specs for a file Vitest cannot trace', () => {
    hook('src/statics/HISTORY_en-US');

    expect(argv().slice(0, 2)).toEqual(['related', 'test/components/ChangeLog.spec.js']);
  });

  test('exits 2 with the output when a spec fails', () => {
    fs.writeFileSync(path.join(root, 'fail'), '');
    const result = hook('src/statics/HISTORY_en-US');

    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toMatch(/^Related Vitest specs failed for src\/statics\/HISTORY_en-US:\nFAIL test\/i18nKeys\.spec\.js$/);
  });

  test('skips, and says so, before pnpm install', () => {
    fs.rmSync(path.join(root, 'node_modules'), { recursive: true });
    const result = hook('src/statics/HISTORY_en-US');

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).systemMessage).toMatch(/^related-tests: skipped, no node_modules in .* \(run pnpm install\)$/);
  });
});
