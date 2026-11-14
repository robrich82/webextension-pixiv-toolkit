/**
 * Finds APIs in a build that are newer than the browserslist floor (#351).
 * Vite lowers syntax to the target but adds no polyfills, so a dependency bump
 * can raise the real minimum browser without anything else noticing (#347).
 *
 * Two checks, since neither covers the other:
 * - eslint-plugin-compat, for web APIs and some static builtins
 *   (`Object.hasOwn`, `structuredClone`). It can't type a receiver, so it
 *   misses prototype methods such as `.toSorted()`, and it misses many statics.
 *   Its API data is the `compat.json` that ast-metadata-inferer 0.8.1 generated
 *   when it was published (December 2024), so it knows no web API added to
 *   browser-compat-data since, and no dependency override can update it (#360).
 * - A list of those, of web-API statics and of CSS, matched by pattern.
 *   Versions come from MDN's browser-compat-data, so an entry drops out once
 *   the floor passes it.
 * Neither sees an instance method of a web API, such as
 * `document.startViewTransition()`.
 */
import fs from 'fs';
import path from 'path';
import bcd from '@mdn/browser-compat-data' with { type: 'json' };
import { ESLint } from 'eslint';
import compat from 'eslint-plugin-compat';

const SCRIPT = /\.[cm]?js$/;

const JS_APIS = [
  ['javascript.builtins.Array.at', /\.at\(/],
  ['javascript.builtins.Array.findLast', /\.findLast(Index)?\(/],
  ['javascript.builtins.Array.toSorted', /\.(toSorted|toReversed|toSpliced)\(/],
  ['javascript.builtins.Array.fromAsync', /\bArray\.fromAsync\b/],
  ['javascript.builtins.ArrayBuffer.transfer', /\.transfer(ToFixedLength)?\(/],
  ['javascript.builtins.Error.isError', /\bError\.isError\b/],
  ['javascript.builtins.Iterator.from', /\bIterator\.from\b/],
  ['javascript.builtins.Map.groupBy', /\bMap\.groupBy\b/],
  ['javascript.builtins.Object.groupBy', /\bObject\.groupBy\b/],
  ['javascript.builtins.Promise.try', /\bPromise\.try\b/],
  ['javascript.builtins.Promise.withResolvers', /\.withResolvers\b/],
  ['javascript.builtins.RegExp.escape', /\bRegExp\.escape\b/],
  // Vite lowers a /…/v literal to this, which throws below Chrome 112 / Firefox 116.
  ['javascript.builtins.RegExp.unicodeSets', /\bRegExp\([^;]{0,1000}?,\s*(["'`])[dgimsuy]*v[dgimsuy]*\1\s*\)/],
  ['javascript.builtins.Set.union', /\.(union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/],
  ['javascript.builtins.String.isWellFormed', /\.(isWellFormed|toWellFormed)\(/],
  ['javascript.builtins.Uint8Array.fromBase64', /\bUint8Array\.from(Base64|Hex)\b|\.(toBase64|setFromBase64|setFromHex)\(/],
  // A selector passed to querySelector(): one unsupported part makes it throw.
  ['css.selectors.has', /:has\(/],
  // Web-API statics such as `URL.canParse` and `AbortSignal.any`.
  ...Object.entries(bcd.api).flatMap(([name, members]) => Object.keys(members)
    .filter(member => member.endsWith('_static'))
    .map(member => [`api.${name}.${member}`, new RegExp(`\\b${name}\\.${member.slice(0, -'_static'.length)}\\b`)]))
];

// Properties an older browser just ignores (text-wrap, interpolate-size) aren't listed.
const CSS_APIS = [
  ['css.at-rules.container', /@container\b/],
  ['css.at-rules.property', /@property\b/],
  ['css.at-rules.scope', /@scope\b/],
  ['css.at-rules.starting-style', /@starting-style\b/],
  ['css.selectors.has', /:has\(/],
  // Vite's CSS minifier lowers nesting, so this is a backstop for the `&` form.
  ['css.selectors.nesting', /[{;}]\s*&/],
  ['css.types.color.color-mix', /\bcolor-mix\(/],
  ['css.types.color.light-dark', /\blight-dark\(/],
  ['css.types.color.oklch', /\bokl(ch|ab)\(/],
  // Not inside a base64 data URI.
  ['css.types.length.lh', /(?<![\w+/.])(\d*\.)?\d+r?lh\b/],
  ['css.types.round', /\b(round|mod|rem)\(/]
];

/**
 * The first version that supports `feature` unflagged, unprefixed and still,
 * or Infinity if none does. A language feature must be supported in full. A
 * web-API static only has to exist, so a partial implementation counts, back
 * through any earlier statement the current one continues.
 */
export function versionAdded(feature, browser) {
  const compatData = feature.split('.').reduce((node, key) => node?.[key], bcd)?.__compat;

  if (!compatData) {
    throw new Error(`browser-compat-data has no ${feature}`);
  }

  const callable = feature.startsWith('api.');
  const statements = [].concat(compatData.support[browser] ?? [])
    .filter(s => !s.flags && !s.prefix && !s.alternative_name && (callable || !s.partial_implementation));
  let added = statements.find(s => !s.version_removed)?.version_added;

  for (let earlier; callable && added && (earlier = statements.find(s => s.version_removed === added));) {
    added = earlier.version_added;
  }

  if (added === true) {
    return 0;
  }

  return typeof added === 'string' && /^≤?\d/.test(added) ? parseFloat(added.replace('≤', '')) : Infinity;
}

function filesIn(dir, pattern) {
  return fs.readdirSync(dir, { recursive: true })
    .filter(file => pattern.test(file))
    .map(file => file.split(path.sep).join('/'));
}

/**
 * `file: feature (needs browser N)` for each listed API in `out` that the
 * floor doesn't support. `guarded` lists patterns to remove first, for uses
 * behind a feature check.
 */
export function newerApiUses(out, { browser, floor, guarded = [] }) {
  const found = [];

  for (const [files, apis] of [[SCRIPT, JS_APIS], [/\.css$/, CSS_APIS]]) {
    const newer = apis.filter(([feature]) => versionAdded(feature, browser) > floor);

    for (const file of filesIn(out, files)) {
      const content = guarded.reduce((text, pattern) => text.replace(pattern, ''), fs.readFileSync(path.join(out, file), 'utf8'));

      for (const [feature, pattern] of newer) {
        if (pattern.test(content)) {
          found.push(`${file}: ${feature} (needs ${browser} ${versionAdded(feature, browser)})`);
        }
      }
    }
  }

  return found;
}

/**
 * `file:line message` for each eslint-plugin-compat report on `out`'s JS, and
 * each file that doesn't parse as ES2023: the floors' newest full edition, and
 * the `lib/` vendor files are copied without being lowered. The plugin adds
 * the targets of any browserslist config above `out` to these.
 */
export async function compatReports(out, { browser, floor }) {
  const eslint = new ESLint({
    cwd: path.resolve(out),
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.{js,mjs,cjs}'],
        plugins: { compat },
        languageOptions: { ecmaVersion: 2023, sourceType: 'script' },
        // Vendored files' own eslint-disable comments mustn't hide anything.
        linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
        settings: { browsers: [`${browser} >= ${floor}`], lintAllEsApis: true },
        rules: { 'compat/compat': 'error' }
      },
      { files: ['**/static/**/*.js', '**/*.mjs'], languageOptions: { sourceType: 'module' } }
    ]
  });
  const results = await eslint.lintFiles(['**/*.{js,mjs,cjs}']);

  return results.flatMap(result => result.messages
    // A parse error is fatal and has no ruleId. Report it, since it hides the file.
    .filter(message => message.fatal || message.ruleId === 'compat/compat')
    .map(message => `${path.relative(out, result.filePath).split(path.sep).join('/')}:${message.line} ${message.message}`));
}
