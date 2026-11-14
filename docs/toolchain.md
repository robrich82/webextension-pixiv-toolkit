# Build toolchain

## Requirements

- Node and pnpm within the `engines` ranges in `package.json`
- `mise.toml` pins the exact Node version, for local development and CI
- `packageManager` pins the exact pnpm version, integrity hash included;
  `mise.toml` tells mise to install pnpm from it, so there is one pnpm pin
- `pnpm install --frozen-lockfile` to install — `pnpm-lock.yaml` is committed
  and CI installs from it

Any other pnpm fetches and runs the `packageManager` version instead (pnpm's
default `pmOnFail: download`), so a stray global pnpm does no harm. Without
mise, only the `engines` ranges apply.

## Toolchain pinning

Every engine range carries a **lower and an upper bound**. An open-ended `>=`
would admit an untested future major silently, and the strict-engines check
could then only enforce a floor.

- **`engines.node`** — one major, the one `mise.toml` pins and CI runs. A
  wider range is a claim nothing tests, and dependencies narrow it without
  notice.
  `test/engines.spec.js` fails when a locked package's own `engines.node` stops
  admitting the whole range, since with `engineStrict` that package would fail
  the install there.
- **`engines.pnpm`** — the floor is v11, because the settings in
  `pnpm-workspace.yaml` are pnpm v11 semantics. pnpm v10 would apply a
  *different* security posture from the same file — `minimumReleaseAge`
  defaults to `0` there rather than `1440`, and `strictDepBuilds` defaults to
  `false` rather than `true`, so an undeclared build script degrades to a
  silent warning instead of failing the install. The ceiling sits below the
  next unvalidated major, as for Node.
- **`packageManager`** — the exact version plus integrity hash. Exact by
  construction, so it is the effective upper *and* lower bound wherever pnpm runs.
- `engineStrict: true` in `pnpm-workspace.yaml` extends the same check to
  dependencies. `engines.pnpm` is enforced unconditionally either way, but
  `engines.node` is only enforced *because* this is set — drop the flag
  thinking it only governs dependencies, and the Node ceiling silently stops
  being checked too, since it is the same setting doing both jobs.

**Raise a ceiling deliberately, after a green CI run on the new major — never
to get unblocked.** Deleting a ceiling converts a loud, early failure into a
silent, late one.

This is also why CI needs no step asserting its Node pin sits *inside*
`engines.node`: pnpm enforces `engines` on every install, so a `mise.toml` pin
outside the range fails the install step outright. That only catches the pin
drifting out of the range, though — it does not catch the range being widened
around an untested pin. Raising the ceiling to admit a new major while leaving
the Node pin where it is passes this check having never run on that major,
which is exactly the case the rule above asks a human to gate deliberately.
Renovate is kept out of it: `renovate.json` disables `engines` updates, so its
major bump of an exact pin fails install until someone raises the ceiling.

**`engines.npm` is `please-use-pnpm`**, a range no npm satisfies, so with
`engine-strict=true` in `.npmrc` npm refuses the install before it extracts or
runs anything.
`scripts/only-pnpm.js` can't stop npm: npm runs the root `preinstall` after
every dependency's install script, the scripts `allowBuilds` exists to gate.
It still refuses yarn and bun. pnpm ignores `engines.npm`.

## Lockfile

`pnpm-lock.yaml` is committed. Keep it out of `.gitignore`: without it every
install silently re-resolves the whole tree, and CI builds from a dependency set
nobody reviewed.

`pnpm install --frozen-lockfile` is the `npm ci` equivalent and what CI runs: it
installs exactly the locked tree and fails when `package.json` and
`pnpm-lock.yaml` disagree, so an edited range cannot quietly reach a build. It
also re-checks the locked versions against the supply-chain policies below, so
those still apply on a run that resolves nothing.

## Supply chain

`pnpm-workspace.yaml` carries the install-time security settings, and each is
set explicitly rather than inherited, so a change to a pnpm default cannot
quietly move the project's posture.

**`minimumReleaseAge: 1440`** — refuse packages published less than one day
ago. This closes the gap the caret ranges leave open: caret cannot cross a
major, but it happily takes a malicious patch the hour it lands, which is the
shape almost every compromised-maintainer incident has had. Renovate uses the
same cooldown, and `renovate.json` restores it for security-update PRs, which
Renovate otherwise exempts, so its PRs install without the exclusion below.

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
> `minimumReleaseAge` further to get an install through — that silently drops
> the protection for every other package in the tree, and a rushed patch is the
> single worst moment to do that.

**`allowBuilds`** — dependency lifecycle scripts are denied by default in pnpm,
and the install *fails* if a package wants to build and is not named in this
map. So the map is a decision log rather than a list of exceptions: both
packages in the tree that declare install scripts are named, and both are
denied.

| Package | Why it is denied |
| --- | --- |
| `@parcel/watcher` | native file watching for `sass --watch`. Unreachable — Vite does the watching here. |
| `fsevents` | macOS-only file watching for Vite's dev server, which `vitest run` never starts. The tarball ships a prebuilt binary, so its `node-gyp rebuild` is redundant anyway. Skipped on Windows and Linux, so only a Mac install would fail without the entry. |

It applies to local installs and CI alike. Adding a `true` here is a security
decision, not a way to clear a failed install — it means a dependency
has started wanting to execute code on every machine that installs this project.

**`blockExoticSubdeps: true`** — transitive dependencies must come from the
registry, never a git repository or a tarball URL. This is pnpm's default,
pinned so it survives a default flip.

**`trustPolicy: no-downgrade`** — fail the install when a package's trust level
drops relative to earlier releases, which is what a maintainer takeover tends to
look like. There are no exclusions; add one only for a confirmed false positive,
pinned to the exact version.

`namedRegistries` is not used: everything here comes from the public npm
registry, so there is nothing to pin to a *different* one, and the setting is
deprecated as of pnpm 11.23.0 in favour of a `prefix` under `registries`.

pnpm's strict, non-flat `node_modules` also removes phantom-dependency
reachability — code can only import what is actually declared — which is a
guarantee npm's flat tree cannot offer at all.

## Version ranges

Almost every dependency sits on a caret range, and that is deliberate: caret
never crosses a major, so a plain `pnpm install` cannot pull in a breaking
release on its own. The `0.x` pins are tighter still — caret on a `0.x`
version locks the *minor*, so `@ffmpeg/core: ^0.12.10` resolves
`>=0.12.10 <0.13.0`.

`typescript` is exact-pinned, and Renovate holds it below 7. It is there only
for the editor's typescript-language-server, which needs its tsserver, and
TypeScript 7 ships none.

The committed lockfile is the second layer, and `minimumReleaseAge` is the
third: caret bounds *which* versions are admissible, the lockfile fixes which
one is actually installed, and the cooldown keeps a brand-new release out of the
resolution step in the first place.

That leaves ordinary drift *inside* the ranges, which is what `pnpm update` is
for: it moves the lockfile and nothing else. `pnpm audit --fix` is the
advisory-driven equivalent; note it edits `overrides` in `pnpm-workspace.yaml`
rather than bumping ranges, so read its diff before committing it.

The one thing to avoid is `pnpm add <pkg>` with no version specifier. That
resolves to latest and rewrites `package.json` to the new major's caret,
updating the lockfile in the same step, so `--frozen-lockfile` will not catch
it — the two files agree, they are just both wrong. No setting prevents this:
`save-exact` only changes the notation, writing `8.0.1` where the caret would
have gone. Name the version you want, and let the `package.json` diff carry the
decision.

## Build

`scripts/build.mjs` builds each target with Vite. Vite lowers syntax to its
`build.target`, in dependencies too, but adds no language polyfills (only its
own modulepreload one).

## browserslist

Targets are `chrome >= 111` / `firefox >= 128` (#347, #354), both set by
Vuetify. Below Chrome 110 / Firefox 115 the options page and download manager
don't load, because @vuetify/v0 calls `Array.prototype.toSorted` at startup.
Chrome 110 loads them without Vuetify's `color-mix()` colours. Firefox below 121
rejects the `:has()` selector Vuetify finds focusable elements with, and below
128 it lacks the `@property` registrations its progress animations use.

Change them in `package.json`'s `browserslist`: autoprefixer reads it, and
`scripts/build.mjs` derives Vite's `build.target` and the manifests' minimum
versions from it. `test/build.spec.js` checks the built JS and CSS against
the floors (`test/helpers/bundleApiFloor.js`, whose header lists what it can't
see), so a dependency bump that uses a newer API it knows fails `pnpm test`.
Either raise the floor, or add the use to `GUARDED`/`GUARDED_COMPAT` (behind a
feature check) or `ACCEPTED` (degrades acceptably, with an issue) in that spec.

## Dependency `overrides`

These live in `pnpm-workspace.yaml`, not `package.json`. **pnpm does not read
npm's top-level `overrides` field** — if these are ever moved back there they
stop applying silently, with no error, and the advisories return.

Each entry is commented in place there. Renovate never proposes a major for
any of them (`renovate.json` disables major updates of the
`pnpm-workspace.overrides` dependency type). Each one is an advisory floor or a
compatibility pin on a deliberately chosen major, and a bot bump to the next
major hands consumers an API they never declared. Same-major updates stay
enabled, so a Renovate vulnerability alert can still raise a floor. One needs
more explanation than fits in a comment:

- **`minimatch` → `^11.0.1`, `multimatch` → `^8.0.0`.** The minimatch floor
  (GHSA-g3hv-75wg-m249) also reaches web-ext's `multimatch@6`, which does
  `import minimatch from 'minimatch'`. v11 has no default export, so
  `web-ext build` and `web-ext lint` crash on import. multimatch 8 uses the
  named export, but minimatch 11 also reads the backslashes in web-ext's
  Windows ignore patterns as escapes, so nothing is ignored and dotfiles,
  `.amo-upload-uuid` and stray zips get packed; `patches/multimatch.patch`
  restores minimatch 3's separator handling on Windows. CI never runs web-ext
  (and is Linux), so a bump that breaks either passes CI. The same default
  import makes the ESM entries of `@eslint/eslintrc` and `@eslint/config-array`
  fail to load; web-ext's eslint 9 `require()`s them, so only a future `FlatCompat`
  config would hit it.

## CI

`.github/workflows/ci.yml` is the main pipeline, running on every pull request
and on pushes to `main`. It needs no third-party signup, so it covers forks
too, and it is what puts a status check on a PR and backs the readme badge.
`.github/workflows/renovate-config.yml` runs only when `renovate.json` (or the
workflow itself) changes, and validates the config with the digest-pinned
Renovate image.

`jdx/mise-action` installs Node and pnpm exactly as local mise does, so CI runs
the same versions as local development. The pnpm store is cached with
`actions/cache`, keyed on `pnpm-lock.yaml`.

The job then runs `pnpm install --frozen-lockfile`,
`pnpm audit --audit-level=moderate`, `pnpm test`, and the Chrome and Firefox
builds, uploading each `dist/` directory as an artifact. Last come the
Playwright E2E suite against `dist/chrome` and the Firefox E2E suite against
`dist/firefox`, which runs even when the Chromium one fails (see
`docs/testing.md`).

The audit step reports at `moderate` but does not fail the job
(`continue-on-error`). It audits dev dependencies too, so an advisory published
overnight against a build tool would otherwise block every merge, Renovate's
automerges included, regardless of whether anything vulnerable ships
(`pnpm audit -P` checks only what does).

A red audit step still needs clearing: `pnpm update`, an `overrides` floor, or
— when the package is abandoned and there is no fixed version —
`auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, with the reason beside it.

The `pnpm test` step is the Vitest suite; see `docs/testing.md` for how it is
configured and for the extension API double the specs run against.
