# Build toolchain

## Requirements

- Node `>=22.12.0 <25.0.0`, pnpm `>=11.0.0 <12.0.0` (see `engines` in `package.json`)
- `.nvmrc` pins the development Node, and CI reads the same file
- `pnpm install --frozen-lockfile` to install — `pnpm-lock.yaml` is committed
  and CI installs from it

pnpm is pinned exactly by the `packageManager` field, integrity hash included.
`corepack enable pnpm` is enough to get it: corepack reads that field and
fetches the pinned version, so nothing has to be installed globally and there is
no global copy to go stale. Anyone not using corepack is caught by
`engines.pnpm` instead — the two fail at different moments, for different
people, which is why both are set.

The project previously pinned Node `~16.18.0`. It could not run on anything
newer: webpack 4 hashes module ids with MD4, which OpenSSL 3 (Node 17+) refuses,
so every build died with `ERR_OSSL_EVP_UNSUPPORTED`. Moving off Node 16
therefore required the webpack 5 migration below; the two could not be done
separately.

### A note for nvm-for-windows

The old warning here was **use the npm that ships with your Node**: a stale
`npm install -g npm` writes itself into the shared global prefix, and under
nvm-for-windows that one copy shadows the npm bundled with *every* installed
Node version. `node --version` would report the new runtime while `npm --version`
was silently years behind, and the two resolved different trees.

That specific trap is gone, because pnpm is no longer something you install
globally. Corepack resolves it per-project from `packageManager`, so there is no
shared global copy to shadow anything. If you do have a global pnpm from before,
it does not matter: pnpm's default `pmOnFail: download` means an invocation that
does not match `packageManager` fetches and runs the pinned version instead.

What has *not* changed is the Node half. nvm-for-windows still switches the
runtime under you, and `.nvmrc` is the pin. Note that nvm-for-windows does not
read `.nvmrc` — a bare `nvm use` fails with *"A version argument is required but
missing"* (checked on 1.2.2). Pass it explicitly:

```bash
nvm use $(cat .nvmrc)
```

CI has no such gap: `actions/setup-node` takes `node-version-file: .nvmrc`
directly. fnm, nodenv and asdf read it too; it is nvm-for-windows specifically
that needs the argument.

Getting the Node version wrong is at least loud now rather than silent: an
out-of-range Node fails the install against `engines.node` instead of quietly
producing a tree nobody else reproduces.

## Toolchain pinning

Every engine range carries a **lower and an upper bound**. Open-ended `>=` was
the previous state and it was wrong in both directions: it admits an untested
future major silently, and it makes the strict-engines check weaker than it
looks, since the only thing an open range can enforce is a floor.

- **`engines.node`** — `>=22.12.0 <25.0.0`. The floor is what the code needs;
  the ceiling sits below the next unvalidated major.
- **`engines.pnpm`** — `>=11.0.0 <12.0.0`. The settings in
  `pnpm-workspace.yaml` are pnpm v11 semantics. pnpm v10 would apply a
  *different* security posture from the same file — `minimumReleaseAge`
  defaults to `0` there rather than `1440`, and `allowBuilds` did not exist —
  and v12 may change it again.
- **`packageManager`** — the exact version plus integrity hash. Exact by
  construction, so it is the effective upper *and* lower bound for corepack
  users.
- `engineStrict: true` in `pnpm-workspace.yaml` extends the same check to
  dependencies. The root project's own `engines` is enforced regardless of that
  setting, so an out-of-range Node or pnpm fails at install time with a clear
  error rather than producing an unreproducible tree.

**Raise a ceiling deliberately, after a green CI run on the new major — never
to get unblocked.** Deleting a ceiling converts a loud, early failure into a
silent, late one.

This is also why CI needs no step asserting its Node pin sits inside
`engines.node`: pnpm enforces `engines` on every install, so a `.nvmrc` outside
the range fails the install step outright. One pin, checked structurally.

## Lockfile

`package-lock.json` and `yarn.lock` used to both be listed in `.gitignore`, so
no lockfile was committed at all — every install silently re-resolved the whole
tree, and CI built from a dependency set nobody had reviewed. `pnpm-lock.yaml`
is now tracked. Do not add it to `.gitignore`; that was the original bug.

`pnpm install --frozen-lockfile` is the `npm ci` equivalent and what CI runs: it
installs exactly the locked tree and fails when `package.json` and
`pnpm-lock.yaml` disagree, so an edited range cannot quietly reach a build. It
also re-checks the locked versions against the supply-chain policies below, so
those still apply on a run that resolves nothing.

## Supply chain

`pnpm-workspace.yaml` carries the install-time security settings, and each is
set explicitly rather than inherited, so a change to a pnpm default cannot
quietly move the project's posture.

**`minimumReleaseAge: 10080`** — refuse packages published less than seven days
ago. This closes the gap the caret ranges leave open: caret cannot cross a
major, but it happily takes a malicious patch the hour it lands, which is the
shape almost every compromised-maintainer incident has had. pnpm v11 defaults to
`1440` (one day); this project is not release-driven and has no reason to be an
early adopter, so the window is longer.

> **A deliberate urgent security bump will appear to fail against this**, which
> is exactly when someone is least inclined to read the docs. The fix is
> `minimumReleaseAgeExclude`, scoped to the package and version being pulled in:
>
> ```yaml
> minimumReleaseAgeExclude:
>   - 'somepkg@1.2.4'
> ```
>
> Remove the entry once the window has passed. Do **not** lower
> `minimumReleaseAge` to get an install through — that silently drops the
> protection for every other package in the tree, and a rushed patch is the
> single worst moment to do that.

**`allowBuilds`** — dependency lifecycle scripts are denied by default in pnpm,
and the install *fails* if a package wants to build and is not named in this
map. So the map is a decision log rather than a list of exceptions: all three
packages in the tree that declare install scripts are named, and all three are
denied.

| Package | Why it is denied |
| --- | --- |
| `leveldown` | pouchdb's native LevelDB binding. Unreachable — pouchdb is a webpack external loaded from its prebuilt browser bundle. |
| `@parcel/watcher` | native file watching for `sass --watch`. Unreachable — watching is webpack's job here. |
| `unrs-resolver` | jest-resolve's native resolver. Its script only checks that the right `@unrs/resolver-binding-*` optional dependency was installed; the binary arrives prebuilt. The suite passes with the script denied. |

This replaces `npm ci --ignore-scripts`, which was correct but lived in one line
of CI YAML and did nothing for a local install. Adding a `true` here is a
security decision, not a way to clear a failed install — it means a dependency
has started wanting to execute code on every machine that installs this project.

**`blockExoticSubdeps: true`** — transitive dependencies must come from the
registry, never a git repository or a tarball URL. This is pnpm's default,
pinned so it survives a default flip.

**`trustPolicy: no-downgrade`** — fail the install when a package's trust level
drops relative to earlier releases, which is what a maintainer takeover tends to
look like. One exclusion is needed, and it is a false positive rather than a
waived risk:

- **`semver@6.3.1`** (2023-07-10) is a maintenance backport to the v6 line,
  published three days after `semver@7.5.4` (2023-07-07) — which *does* carry a
  SLSA provenance attestation. Trust level is judged by publish date, not by
  semver line, so the older major reads as a regression from the newer one. Same
  repository (npm's own node-semver), same maintainers, and it reaches this
  project only through the Babel toolchain, which is build-time only. The
  exclusion pins the exact version, so a genuinely regressed semver 6.x would
  still fail.

`namedRegistries` is not used: everything here comes from the public npm
registry, so there is nothing to pin to a *different* one, and the setting is
deprecated as of pnpm 11.23.0 in favour of a `prefix` under `registries`.

pnpm's strict, non-flat `node_modules` also removes phantom-dependency
reachability — code can only import what is actually declared — which is a
guarantee npm's flat tree cannot offer at all.

## Version ranges

Every dependency sits on a caret range, and that is deliberate: caret never
crosses a major, so a plain `pnpm install` cannot pull in a breaking release on
its own. The two `0.x` pins are tighter still — caret on a `0.x` version locks
the *minor*, so `@ffmpeg/core: ^0.11.0` resolves `>=0.11.0 <0.12.0` and holds
the ffmpeg upgrade shut until someone does all three parts of it at once (see
Known remaining issues).

The committed lockfile is the second layer, and `minimumReleaseAge` is the
third: caret bounds *which* versions are admissible, the lockfile fixes which
one is actually installed, and the cooldown keeps a brand-new release out of the
resolution step in the first place.

That leaves ordinary drift *inside* the ranges, which is what `pnpm update` is
for: it moves the lockfile and nothing else. `pnpm audit --fix` is the
advisory-driven equivalent; note it edits `overrides` in `pnpm-workspace.yaml`
rather than bumping ranges, so read its diff before committing it. The security
patches applied on 2026-08-27 needed no `package.json` change at all, because
every fixed version was already admissible — including through the `overrides`
floor below.

The one thing to avoid is `pnpm add <pkg>` with no version specifier. That
resolves to latest and rewrites `package.json` to the new major's caret,
updating the lockfile in the same step, so `--frozen-lockfile` will not catch
it — the two files agree, they are just both wrong. No setting prevents this:
`save-exact` only changes the notation, writing `8.0.1` where the caret would
have gone. Name the version you want, and let the `package.json` diff carry the
decision.

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
  `--env platform=firefox`. The `package.json` scripts already pass the new form.

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

These live in `pnpm-workspace.yaml`, not `package.json`. **pnpm does not read
npm's top-level `overrides` field** — if these are ever moved back there they
stop applying silently, with no error, and both advisories return.

Note the flattened key syntax: npm's nested
`{"@vue/component-compiler-utils": {"postcss": "..."}}` becomes
`'@vue/component-compiler-utils>postcss'`.

Both entries exist to keep `pnpm audit` quiet, **not** because either advisory
is reachable here. Verify before removing them:

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

To confirm both are still applied, check that `pnpm-lock.yaml` resolves exactly
one `uuid@11.x` and that the `@vue/component-compiler-utils` snapshot depends on
`postcss: 8.x`.

## Build output under pnpm

The build is *equivalent* under pnpm but not byte-identical, and that is
expected rather than a symptom. webpack derives its deterministic module and
chunk ids from module request paths, and pnpm's paths
(`node_modules/.pnpm/vuetify@1.5.24_vue@2.7.16/node_modules/vuetify/…`) differ
from npm's flat ones. So chunk ids renumber, emitted chunk filenames change with
them, and terser's variable naming shifts with the resulting module order.

Built against identical dependency versions, the bundles match to within twelve
bytes each (the ids have different digit counts), and the smallest bundle is
byte-identical. Anyone diffing `dist/` across this migration should expect
renamed numeric chunks and no size change worth noticing.

`config/webpack.background.config.js` copies five paths out of `node_modules`
(`vue`, `vue-i18n`, `pouchdb` ×2, and the `@ffmpeg/core/dist` directory). All
five are direct dependencies, so pnpm's symlinked top level exposes them and
`copy-webpack-plugin` resolves through the symlinks into `node_modules/.pnpm`
without help. This is verified by the builds, not just reasoned about — but it
is the thing to check first if a copied asset ever goes missing.

Because pnpm's `node_modules` is strict and non-flat, anything the build imports
without declaring will now fail where npm's flat tree let it through. That is
the layout doing its job: the fix is to declare the dependency, not to loosen
`node-linker`.

## CI

`.github/workflows/ci.yml` is the only pipeline, running on every pull request
and on pushes to `master`. It needs no third-party signup, so it covers forks
too, and it is what puts a status check on a PR and backs the readme badge.

`pnpm/action-setup` runs before `actions/setup-node` — setup-node needs pnpm on
`PATH` to resolve the store for `cache: pnpm`. It is given no `version` input on
purpose: it reads the exact version and integrity hash from `packageManager`,
so there is one place to bump pnpm. Node comes from `.nvmrc` for the same
reason.

The job then runs `pnpm install --frozen-lockfile`,
`pnpm audit --audit-level=moderate`, `pnpm test`, and the Chrome and Firefox
builds, uploading each `dist/` directory as an artifact.

The audit gate is set at `moderate` because the Vue 2 EOL advisory is `low` and
standing; failing at `moderate` keeps a new problem from being lost in that
noise. pnpm reports that advisory at the same severity npm did, so the gate
behaves as it always has.

CircleCI (`.circleci/config.yml`) ran the identical job and was dropped as
duplication.

The `pnpm test` step is the Jest suite; see `docs/testing.md` for how it is
configured and for the extension API double the specs run against.

## Known remaining issues

- **Vue 2 is EOL** (December 2023) and carries an unfixable ReDoS advisory
  (GHSA-5j4c-8p2g-v4jx). This is the only advisory `pnpm audit` still reports, via
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
