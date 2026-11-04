/**
 * vue-i18n renders a missing key as its raw path (`_foo.message`), and most
 * component specs stub `tl` as `key => key`, so a typo'd key passes every
 * other test (#169). This checks each string-literal key passed to `tl()` or
 * `$t()` in src exists in both locales; keys built at runtime aren't covered.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../src');
const LOCALES = ['en', 'zh_CN'];

// src/statics holds vendored third-party libraries, not components.
const files = fs.readdirSync(SRC, { recursive: true })
  .filter(file => /\.(vue|js)$/.test(file) && !file.startsWith(`statics${path.sep}`));

const usedKeys = new Map();
for (const file of files) {
  const source = fs.readFileSync(path.join(SRC, file), 'utf8');
  for (const [, key] of source.matchAll(/(?:\btl|\$t)\(\s*['"`](\w+)['"`]/g)) {
    usedKeys.set(key, (usedKeys.get(key) || new Set()).add(file));
  }
}

test('the scan finds keys in every UI bundle', () => {
  const scanned = new Set([...usedKeys.values()].flatMap(where => [...where]).map(file => file.split(path.sep)[0]));

  expect([...scanned]).toEqual(expect.arrayContaining(['content_scripts', 'options_page', 'popup_page']));
});

test.each(LOCALES)('every literal i18n key in src exists in %s', locale => {
  const messages = JSON.parse(fs.readFileSync(path.join(SRC, 'statics/_locales', locale, 'messages.json'), 'utf8'));
  const missing = [...usedKeys]
    .filter(([key]) => !Object.hasOwn(messages, key))
    .map(([key, where]) => `${key} (${[...where].join(', ')})`);

  expect(missing).toEqual([]);
});
