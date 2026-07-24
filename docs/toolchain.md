# Build toolchain

## Requirements

- Node `>=22.12.0`, npm `>=10.9.0` (see `engines` in `package.json`)
- `npm ci` to install — `package-lock.json` is committed and CI installs from it

The project previously pinned Node `~16.18.0`. It could not run on anything
newer: webpack 4 hashes module ids with MD4, which OpenSSL 3 (Node 17+) refuses,
so every build died with `ERR_OSSL_EVP_UNSUPPORTED`. Moving off Node 16
therefore required the webpack 5 migration below; the two could not be done
separately.

## Lockfile

`package-lock.json` and `yarn.lock` used to both be listed in `.gitignore`, so
no lockfile was committed at all — every install silently re-resolved the whole
tree, and CI built from a dependency set nobody had reviewed. `package-lock.json`
is now tracked, and yarn is gone (CI used yarn, the docs said npm).

**Use the npm that ships with your Node.** A stale `npm install -g npm` writes
itself into the shared global prefix, and under nvm-for-windows that one copy
shadows the npm bundled with *every* installed Node version. That is easy to miss
— `node --version` reports the new runtime while `npm --version` is silently
years behind — and the two npms resolve different trees. `.npmrc` sets
`engine-strict=true` so an out-of-range npm or Node fails with `EBADENGINE` at
install time rather than quietly committing a lockfile nobody else reproduces.

`npm ci --ignore-scripts` is used in CI. No dependency here needs a build step:
the only two declaring install scripts are `leveldown` (pouchdb's native Node
LevelDB binding) and `@parcel/watcher` (for `sass --watch`), and neither is
reachable — pouchdb is a webpack external loaded from its prebuilt browser
bundle, and watching is webpack's job. npm 11 blocks install scripts by default;
being explicit keeps the result identical across npm versions and removes a
well-worn supply-chain foothold.

## webpack 4 → 5 notes

Things that needed changing beyond version numbers:

- **`node: {fs: 'empty', ...}` → `resolve.fallback: {fs: false, ...}`.** webpack 5
  stopped auto-polyfilling Node core modules. Nothing in `src` imports them, so
  they resolve to nothing rather than pulling in browser shims.
- **`url-loader`/`file-loader` → asset modules.** `utils.assetRules()` replaces
  three near-identical rule blocks that were duplicated across the options-page,
  popup and content-script configs. `type: 'asset'` with a `maxSize` of 10000
  reproduces `url-loader`'s `limit: 10000`. Note asset modules' `[ext]` already
  includes the leading dot.
- **`json-loader` and `uglifyjs-webpack-plugin` dropped.** webpack 5 parses JSON
  natively and ships terser as the default minimizer. (`uglifyjs-webpack-plugin`
  was in `dependencies`, and imported in the base config without ever being used.)
- **`target: 'web'` is now explicit.** webpack 5 otherwise infers its target from
  the `browserslist` field, which would change the emitted runtime — including in
  the background service worker bundle. Pinning it keeps the runtime the shape it
  had under webpack 4.
- **Copied assets are marked `info: { minimized: true }`.** webpack 5 runs its
  minimizer over *every* emitted asset, including ones `copy-webpack-plugin`
  passes through. Without this, the vendored libraries under `src/statics/lib`
  were re-minified (`handlebars-latest.js` 514K → 62K, `jszip.js` 423K → 100K),
  already-minified files got *larger* from double processing (`vue.min.js`
  94K → 108K), and every license banner was hoisted out into a separate
  `.LICENSE.txt`, stripping attribution from third-party code.
- **`webpack-cli` 3 → 7 changed the env flag**: `--env.platform=firefox` is now
  `--env platform=firefox`. The `npm run` scripts already pass the new form.

## postcss / sass loader options

`postcss-loader` 8 takes plugin config under `postcssOptions` (still loaded from
`.postcssrc.js`), and `sass-loader` 8+ takes preprocessor options under
`sassOptions` rather than at the top level. `utils.cssLoaders()` also now sets
`importLoaders` so `@import` inside a stylesheet is passed back through postcss
and sass instead of being inlined verbatim.

`config/vue-loader.config.js` had been carrying vue-loader **v14** options
(`loaders`, `cssSourceMap`, `cacheBusting`, `transformToRequire`) that v15 has
silently ignored for years. Only the renamed `transformAssetUrls` survives; SFC
`<style>` blocks are resolved from the top-level module rules.

## browserslist

Targets are now `chrome >= 88` / `firefox >= 109` — the floor for manifest v3 —
replacing `> 1%, last 2 versions, chrome >= 48`. This is why the built CSS is
~20% smaller: autoprefixer no longer emits `-ms-`/`-webkit-` placeholder and
keyframe prefixes that no supported browser needs.

## Dependency `overrides`

Both entries exist to keep `npm audit` quiet, **not** because either advisory is
reachable here. Verify before removing them:

- **`uuid` → `^11.1.1`.** `pouchdb-utils` pins uuid 8. The advisory
  (GHSA-w5hq-g745-h8pq) is a missing bounds check in `v3`/`v5`/`v6` when called
  with a `buf` argument; pouchdb only ever calls `v4` (its own source comments
  say so). uuid 11 keeps the `v4` signature.
- **`@vue/component-compiler-utils` → `postcss@^8.5.22`.** vue-loader 15 only
  loads this package on its pre-2.7 code path. With Vue 2.7 installed,
  `lib/compiler.js` takes the `is27` branch and uses `vue/compiler-sfc` instead,
  so neither the package nor its postcss 7 is ever required at build time. This
  is also why `vue-template-compiler` is no longer a devDependency — the same
  branch sets `templateCompiler: undefined`, and it is an optional peer.

## Known remaining issues

- **Vue 2 is EOL** (December 2023) and carries an unfixable ReDoS advisory
  (GHSA-5j4c-8p2g-v4jx). This is the only advisory `npm audit` still reports, via
  `vue`, `vuetify` and `vue-virtual-scroller`. See `docs/vue3-migration.md`.
- **ffmpeg is pinned to 0.11.** `@ffmpeg/core` is copied into `lib/ffmpeg`, but
  the code loads a *vendored* `src/statics/lib/ffmpeg/ffmpeg.min.js` (0.11.6) as
  a `FFmpeg` global and uses the 0.11 API (`createFFmpeg`, `.FS()`,
  `.setProgress()`). `@ffmpeg/ffmpeg` is a devDependency only because
  `UgoiraDownloadTask.js` references its type in a JSDoc comment. Upgrading to
  0.12 means replacing the vendored file *and* rewriting the call sites against
  the new class/worker API — do all three together or not at all.
- **`worker-loader` is unmaintained.** webpack 5 supports
  `new Worker(new URL('./x.worker.js', import.meta.url))` natively, but it emits
  the worker as a separate chunk rather than inlining it, which for a content
  script would need a `web_accessible_resources` entry. `worker-loader`'s
  `inline: "no-fallback"` avoids that. Worth revisiting, but it is a runtime
  behaviour change, not a drop-in swap.
