/**
 * .claude/hooks/settings-migration-reminder.js tells Claude to consider a
 * settings migration after it edits src/config/default.js.
 */
import { spawnSync } from 'child_process';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, '.claude/hooks/settings-migration-reminder.js');

const hook = (input) => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', timeout: 30000 });
const edit = (filePath) => JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath } });

test.each([
  ['an absolute path', path.join(ROOT, 'src/config/default.js')],
  ['a Windows path', 'C:\\Users\\me\\code\\worktrees\\repo\\branch\\src\\config\\default.js'],
  ['a relative path', 'src/config/default.js']
])('adds the reminder for %s to the defaults', (_, filePath) => {
  const result = hook(edit(filePath));

  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: expect.stringContaining('add-settings-migration skill') }
  });
});

test.each([
  ['another file', edit(path.join(ROOT, 'src/config/index.js'))],
  ['a file that only ends like it', edit(path.join(ROOT, 'src/config/default.json'))],
  ['the same name elsewhere', edit(path.join(ROOT, 'test/config/default.js'))],
  ['input that is not JSON', 'not json'],
  ['a tool call without a file', JSON.stringify({ tool_input: {} })]
])('stays silent for %s', (_, input) => {
  const result = hook(input);

  expect(result.status).toBe(0);
  expect(result.stdout + result.stderr).toBe('');
});
