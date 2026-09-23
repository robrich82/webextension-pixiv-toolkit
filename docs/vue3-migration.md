# Vue 3 + Vuetify 3 migration (follow-up)

Scoping notes for the branch that clears the last standing advisory.

**Phase A (the toolchain bump + every global integration point) has landed**
on `feature/vue3-vuetify3-migration-26` — see that branch's `build/
vue3-toolchain-bump-26` PR. **Phase B (the leaf `option-items` components) has
also landed**, via `feature/vue3-phase-b-option-items-26` — see "Phase B
discovery" below for what actually registering Vuetify 3's components turned
up. **Phase C (`options_page/components/options`, 19 files) has also
landed**, via `feature/vue3-phase-c-options-26` — see "Phase C notes" below.
**Phase D (the rest of the options page, 19 files) has also landed**, via
`feature/vue3-phase-d-options-page-26` — see "Phase D notes" below, in
particular the webpack config fix that every prior phase's browser-load claim
turned out not to have actually exercised. Every other `.vue` component
template is still on Vuetify 1.5 markup; the phases below this point are
what's left.

## Why this was outstanding

Vue 2.7 reached end of life in December 2023. `GHSA-5j4c-8p2g-v4jx` (ReDoS in
`parseHTML`) had no Vue 2 fix and never would. It was the sole remaining
finding that reached the shipped bundle (`pnpm audit -P`), reported over six
dependency paths: directly against `vue`, and transitively via `vue-i18n`,
`vue-router`, `vuetify`, `vue-virtual-scroller` and `vue-resize`. As of Phase A,
`pnpm audit -P` reports no known vulnerabilities — those packages are gone.

**Practical exposure was low even before the fix.** The advisory needed an
attacker-controlled *template*, and templates here are compiled at build time.
The full Vue build (`lib/vue.min.js`, which included the runtime compiler) was
loaded, so the parser was present, but nothing fed it untrusted markup. This
was EOL-and-audit hygiene, not an actively exploitable hole — which is why it
was reasonable to defer as long as it was.

## Size of the job

| | count |
|---|---|
| `.vue` single-file components | 51 |
| Lines across those SFCs | ~7,974 |
| Files touching Vuetify | 29 |

Component spread: 20 in `options_page/components/options`, 17 in
`options_page/components`, 6 in `content_scripts/components`, 5 in
`options_page/components/options/option-items`, 2 in `options_page`, 1 in
`popup_page`.

The dominant cost is **Vuetify 1.5 → 3**, not Vue itself. Vuetify 1.5 is three
majors behind and the component API was reworked twice in between.

## Vuetify component inventory

Ordered by occurrences — the top three are the whole ballgame:

| Vuetify 1.5 | uses | Vuetify 3 |
|---|---|---|
| `v-list-tile` | 75 | `v-list-item` |
| `v-list-tile-content` | 69 | removed — content is the default slot |
| `v-list-tile-title` | 67 | `v-list-item-title` component, or (the pattern Phase B chose) a `#title` slot on the parent `v-list-item` |
| `v-list-tile-action` | 60 | `v-list-item-action` component, or (the pattern Phase B chose) an `#append` slot on the parent `v-list-item` |
| `v-btn` | 42 | `v-btn`, but `flat`→`variant="text"`, `depressed`→`variant="flat"` |
| `v-list-tile-sub-title` | 40 | `v-list-item-subtitle` component, or a `#subtitle` slot (Phase B's choice) |
| `v-list` | 29 | `v-list`, but `two-line`/`three-line` → `lines="two"`/`lines="three"` |
| `v-icon` | 26 | `v-icon` — default icon set is `mdi` (`mdi-`-prefixed); Material ligature names (`open_in_new`) render no glyph |
| `v-select` | 25 | `v-select` — `items` shaped `{text, value}` needs explicit `item-title="text"` (`item-value` needs no change — V3's default already reads `value`) |
| `v-card` / `v-card-text` / `v-card-title` / `v-card-actions` | 42 | mostly 1:1 |
| `v-switch`, `v-text-field` | 21 | `.sync`/`v-model` semantics change |
| `v-dialog` | 9 | `persistent`/activator slot syntax changed |
| `v-content` | 2 | `v-main` |
| `v-layout` / `v-container` | 5 | grid rewritten (`v-row`/`v-col`) |
| `v-expansion-panel-content` | 7 | `v-expansion-panel-text` |
| `v-toolbar`, `v-navigation-drawer`, `v-menu`, `v-tooltip`, `v-alert`, `v-progress-*`, `v-divider`, `v-spacer` | ~20 | mostly 1:1 with prop renames |

The ~271 `v-list-tile*` usages are the single biggest mechanical change and are
largely scriptable with a careful codemod, but `v-list-tile-content` dissolving
into the default slot means the surrounding markup has to be restructured, not
just renamed.

## Framework-level breaking changes to expect

- **`new Vue()` → `createApp()`**, and `Vue.mixin(SuperMixin)` becomes an
  app-level mixin. Done in Phase A for all four root entry points.
- **`this.$set`/`this.$delete` are removed** (Vue 3's reactivity doesn't need
  them for already-declared properties). Live call sites, found during Phase
  A's review but out of that phase's scope to fix: `src/content_scripts/
  components/PageSelector.vue` (5 call sites) and `src/options_page/
  components/DownloadManager.vue` (1). Both throw `TypeError: this.$set is
  not a function` the moment those code paths run — a hard blocker for
  whichever phase touches each file (DownloadManager.vue below, PageSelector.vue
  in the content_scripts phase).
- **Filters are removed** in Vue 3 — grep for `|` in templates.
- **`v-model` on components** changed prop/event names (`value`/`input` →
  `modelValue`/`update:modelValue`). This hits every `option-items` component.
- **`.sync` modifier removed**, folded into `v-model:foo`.
- **`$listeners` merged into `$attrs`**; `$children` removed.
- **Functional/`$scopedSlots`** API changes.
- **`vue-router` 3 → 4**: `new VueRouter()` → `createRouter()`, `mode: 'hash'` →
  `createWebHashHistory()`, and `router.push()` on a duplicate navigation now
  *resolves* with a `NavigationFailure` instead of rejecting — done in Phase A
  (`src/options_page/router/index.js`, `src/mixins/SuperMixin.js`).
- **`vue-i18n` 8 → 11**: `VueI18n` constructor → `createI18n({ legacy: true,
  fallbackLocale: 'en', ... })` — done in Phase A (`src/modules/I18n.js`). Note
  the vue-i18n 9+ default for `fallbackLocale` changed to the current locale
  itself rather than `'en'`, so it now has to be set explicitly.
- **`vue-virtual-scroller` 1 → 3** (2.x was skipped; 3.x is the first Vue-3-
  compatible major) — dependency bumped in Phase A, but `DownloadManager.vue`
  and `History.vue`'s actual usage is unmigrated. `vuedraggable` turned out to
  be unused (zero imports in `src/`) and was dropped entirely in Phase A
  rather than migrated.

## Build-side changes this unlocks

Done in Phase A:
- `vue-loader` 15 → 17, `@vue/compiler-sfc` replaces `vue/compiler-sfc`.
- Both dependency `overrides` in `pnpm-workspace.yaml` are gone — the
  `@vue/component-compiler-utils` one because vue-loader 17 doesn't load that
  package at all, and the `GHSA-g3ch-rx76-35fx` audit-ignore because
  `vue-template-compiler` (the only thing that reached it) is gone too. The
  `uuid` override stays; it's unrelated to Vue.
- `vue-style-loader` replaced with `style-loader`; `.babelrc` replaced with a
  root `babel.config.js` (a package-relative `.babelrc` doesn't apply across
  package boundaries, so it couldn't reach Vuetify 3's ESM source under Jest).
- The two vendored globals renamed: `lib/vue.min.js` → `lib/vue.global.prod.js`,
  `lib/vue-i18n.min.js` → `lib/vue-i18n.global.prod.js` (webpack's `CopyPlugin`,
  both HTML `<script>` tags, and `manifest.json`'s `content_scripts[0].js` list
  all had to change together — the last of those three was easy to miss).

## Phase B discovery: `createVuetify()` was never registering any components

Phase A called `createVuetify()` with no `components`/`directives` in both
options-page entry points (`index.js`, `downloads.js`) and in the shared test
helper. `createVuetify()` on its own registers nothing — every Vuetify tag
app-wide rendered as an inert, unresolved custom element, in production and in
every component spec, for the whole lifetime of Phase A. Phase B fixed this
(now centralized in `src/options_page/vuetify.js`, imported by both entry
points and by `test/helpers/mountOptionComponent.js`, so the three copies
can't drift apart again the way they just did).

**This has a blast radius far wider than the 4 migrated files.** Registering
the real component set means every *unmigrated* Vuetify tag whose name still
exists in Vuetify 3 now activates as that real V3 component, driven by
Vuetify-1.5-shaped props it doesn't understand — while the `v-list-tile*`
family (renamed, not reused) stays inert as before. Concretely, until later
phases land, expect:

- **Every other `<v-select>` with `{text, value}` items and no `item-title`**
  (19 occurrences across `InterfaceOptions.vue`, `UgoiraOptions.vue`,
  `GlobalTaskSettings.vue`'s own two non-migrated selects, and others) to
  render `[object Object]` as the selection and blank dropdown rows.
- **`@change` on `v-select`/`v-switch`** (6 occurrences, e.g.
  `InterfaceOptions.vue`) — Vuetify 3 doesn't emit `change`, so the bound
  handlers (locale switch, panel reposition) silently stop firing; the
  underlying `v-model` value still persists correctly.
- **`<v-navigation-drawer app clipped hide-overlay>`** (`Index.vue`) — `app`,
  `clipped`, `hide-overlay` are all removed props, and there is no
  `<v-main>` anywhere in `src` to receive the V3 layout offset, so the drawer
  will overlay page content instead of pushing it.
- **`<v-list two-line>`** elsewhere (~22 sites) falls through as a stray DOM
  attribute instead of `lines="two"` — subtitles get clamped to one line.
- **`<v-dialog v-model.sync="...">`** (`.sync` was removed in Vue 3) compiles
  to a stray `modelModifiers: {sync:true}`; the dialog still works via
  `modelValue`, but this path is newly reachable and untested.
- Stray removed props landing on the DOM as plain attributes:
  `<v-btn depressed>`, `<v-text-field reverse>`, `<v-divider light>`.

**None of this is a regression** — before the fix, nothing rendered at all,
so this PR strictly improves what's on screen (the 4 migrated rows now work
correctly). But it changes "inert" to "broken/warning-laden" everywhere else,
which will surprise anyone who loads the extension between Phase B and
whichever phase fixes each spot above. Each item is exactly the kind of fix
its own phase already plans to make; nothing here needs doing early, but the
"Vuetify component inventory" table above and the per-phase file lists are
where to check before assuming a given tag is fine as-is.

**Bundle size:** `createVuetify({ components, directives })` passes whole
namespace objects, which defeats webpack tree-shaking — the whole Vuetify 3
library is now bundled regardless of what's used. Measured: `index.js` and
`downloads.js` each grew by ~540 KB JS / ~310 KB CSS. The fix is necessary
(nothing rendered without it) so this isn't worth blocking on mid-migration,
but it should not be the end state — investigate a webpack per-component
auto-import setup (the webpack analogue of `vite-plugin-vuetify`) before the
final phase merges to `main`.

## Phase C notes: `options_page/components/options` (19 files)

Mechanical `v-list-tile*` → `v-list-item` (`#title`/`#subtitle`/`#append`
slots), `two-line` → `lines="two"`, and `item-title="text"` on every
`v-select` landed across all 19 files per the inventory table above. A few
things that weren't just renames:

- **`v-model` on `RenameDialog.vue`** (used bare — `v-model="renameRule"` — by
  6 of the other 18 files) needed the `value`/`input` → `modelValue`/
  `update:modelValue` rename described above; Vue 3's compiler has no way to
  target a custom prop/event pair from a *bare* `v-model` the way Vue 2's
  `model` option could. `:show.sync="..."` on the same tag became
  `v-model:show="..."` — `RenameDialog.vue` already emitted `update:show`, so
  only the call sites changed. `ChangeLocationBtn.vue`'s `location` prop kept
  its own name (already `update:location`), so its caller just became
  `v-model:location="location"`.
- **`v-menu`/`v-tooltip` activator slots** changed shape: `v-slot:activator="{
  on }"` + `v-on="on"` → `v-slot:activator="{ props }"` + `v-bind="props"`.
  `v-menu`'s old `top`/`offset-x`/`left` boolean props are gone too, replaced
  by a single `location="top"` (an approximation of the old three-prop
  combination, not a pixel-exact port).
- **`v-expansion-panel(-content)` → `v-expansion-panels`/`v-expansion-panel`/
  `v-expansion-panel-title`/`v-expansion-panel-text`** in
  `DownloadTaskSettings.vue` — Vuetify 3 renamed the plural *and* singular
  roles, not just the content tag, so this was a structural rewrite, not a
  find/replace.
- **`v-icon`/`v-btn`'s `small` boolean prop is gone**, replaced by
  `size="small"`. Ligature icon names (`info`, `keyboard_arrow_right`) became
  `mdi-information`/`mdi-chevron-right` — Vuetify 3's default icon set is
  `mdi` (already wired in Phase A via `@mdi/font`), not Material ligatures.
- **`@change` on `v-select`/`v-switch`** (flagged in "Phase B discovery") was
  fixed by renaming the listener to `@update:model-value` in place — *not* by
  moving the logic into a generic `watch`, which would also fire on the
  component's own programmatic `beforeMount`/`created` assignments and change
  behaviour (`DownloadsShelfOption.vue`'s permission-request flow only fires
  on user interaction, not when the stored value is echoed back in).
- **Function-coverage regression:** converting `<v-list-tile-title>` etc. into
  `<template #title>` scoped slots means each slot's render code is now its
  own function in the compiled output — and `shallowMountOption`'s
  `renderStubDefaultSlot` stub (see `docs/testing.md`) only ever renders a
  stubbed component's *default* slot, so none of those title/subtitle/append
  functions run under the existing `shallowMountOption`-only specs. This
  silently dropped `options_page/components/options`'s function coverage from
  95.03% to 91.3%, tripping the coverage floor. Fixed by adding one
  `mountOption` (real mount) smoke test per affected file, asserting the
  rendered title text — the same pattern Phase B already used in
  `DownloadSaveMode.spec.js`. `v-dialog` content (`UgoiraExtendDialog.vue`)
  teleports to `document.body` rather than staying under the mounted
  wrapper's root, so that one component's smoke test reads
  `document.body.textContent` instead of `wrapper.text()`.
- **jsdom gap:** a real (non-shallow) mount of anything using Vuetify's
  overlay positioning (`v-dialog`, `v-menu`, `v-select`'s dropdown) now also
  needs `visualViewport` on `globalThis` — jsdom doesn't define it at all
  (unlike `ResizeObserver`, which is at least `undefined`), so a bare
  reference throws `ReferenceError` before Vuetify's own `?.` guard can help.
  Shimmed alongside the existing `CSS`/`ResizeObserver` shims in
  `test/setup/jsdomGlobals.js`.
- **Left alone, matching pre-existing test comments:** `RenameDialog.vue`'s
  `hint` prop/computed shadowing and `pickMeta`'s `$refs` read (2 still-`test.skip`ped
  specs) and `PixivComicOptions.vue`'s undeclared `showRenameImageDialog` dead
  binding — none of these are markup issues, and fixing them wasn't part of
  this phase's scope.

## Phase D notes: the rest of the options page (19 files)

Scope: the 17 files directly under `options_page/components/*.vue` (not the
`options/` subdirectory — that was Phase C) plus the 2 root layout files
`options_page/Index.vue` and `options_page/Downloads.vue`. Same mechanical
renames as Phase C (`v-list-tile*` → `v-list-item`, `mdi-*` icons,
`depressed`/`flat`/`small` → `variant`/`size`), plus several things that were
new to this phase:

- **The blank-page bug, and why three prior phases didn't catch it.**
  Loading the built (`pnpm run build`/`build:firefox`, i.e. production-mode)
  extension in an actual browser for the first time (no prior phase's "Test
  plan" had done this — all of them ran `pnpm test` against jsdom and/or a
  jest-only DOM probe) threw `ReferenceError: __VUE_PROD_DEVTOOLS__ is not
  defined`, before anything rendered. Cause: `config/webpack.base.config.js`'s
  `DefinePlugin` only ever defined `PRESET_BROWSER` — never the
  `__VUE_OPTIONS_API__`/`__VUE_PROD_DEVTOOLS__`/
  `__VUE_PROD_HYDRATION_MISMATCH_DETAILS__` compile-time flags Vue 3 expects
  a bundler to replace. The actual thrower is **vue-router** (bundled raw by
  webpack, unlike `vue` itself which is loaded as an external global) — its
  source references those flags as bare identifiers guarded only by
  `process.env.NODE_ENV !== "production"`, so the crash is production-build-
  only; `dev`/`dev:firefox` (no `NODE_ENV=production`) and `pnpm test`
  (jsdom) never hit it, which is why the whole test suite stayed green while
  every real (built) page load crashed to blank white. Fixed by adding the
  three flags to the existing `DefinePlugin` call. **This means Phase A/B/C
  were never actually verified rendering in a browser** — their "Test plan"
  checklists' DOM-inspection claims were jest-only. Worth an explicit manual
  sanity load of a production build after any future phase, not just
  `pnpm test` + `pnpm run build`.
- **`this.$set` in `DownloadManager.vue`** (the hard blocker this doc's
  sequencing flagged) — replaced with a plain indexed assignment
  (`this.downloads[index] = downloads[i]`); Vue 3's Proxy-based reactivity
  tracks that natively.
- **Vue 2's `slot="name"` template syntax is gone, silently** — Vue 3 only
  understands `v-slot`/`#`. `DownloadManager.vue`'s `<template
  slot="actions">` compiled to a plain (ignored) HTML attribute under Vue 3,
  so `DownloadTask.vue`'s `#actions` slot never received content and the
  delete/show-in-folder row silently stopped rendering. Fixed as `#actions`.
  Grep the rest of the codebase for `slot="` before trusting any
  not-yet-migrated file's slots work.
- **`beforeDestroy`/`destroyed` lifecycle hooks are gone too, and just as
  silently** — Vue 3 renamed them to `beforeUnmount`/`unmounted`; the old
  names aren't recognized or errored on, just never called.
  `History.vue`'s `beforeDestroy` (removing its `window` scroll listener)
  never fired, a real leak. This wasn't in this doc's "Framework-level
  breaking changes" list before now — **`content_scripts/App.vue` and
  `PageSelector.vue` both still use `beforeDestroy` too** (grepped, unfixed,
  out of this phase's scope) and need the same rename whenever that phase
  lands.
- **`v-navigation-drawer`/`v-toolbar` → `v-app-bar`/`v-main` layout
  rewrite** in `Index.vue`/`Downloads.vue` (the "Phase B discovery" item
  about the nav drawer overlaying content, now resolved): `app`, `clipped`,
  `hide-overlay` are gone from `v-navigation-drawer` (Vuetify 3's layout
  system auto-registers layout components, no `app` prop needed); the page
  header toolbar became `v-app-bar` (`v-toolbar` itself dropped `app`/
  `fixed`/`clipped-left`, and is no longer a layout-participating component
  in v3); `v-content` → `v-main`. A self-review pass also flagged
  `Index.vue`/`Downloads.vue`'s `<v-main style="padding-left:0;">` as a
  likely regression — `v-main` sets its drawer offset via a
  `--v-layout-left`-driven `padding-left` in its own stylesheet, and an
  inline literal on the same property always wins the cascade regardless of
  the CSS variable underneath. Confirmed by reading Vuetify 3's `VMain`
  source (the inline style and the computed layout style get merged onto the
  same element, so it's a plain specificity collision, not a JS-level prop
  conflict) and removed the override in both files.
- **`History.vue`'s `<style lang="scss">` block still targeted 3 dead
  Vuetify 1.5 input classes**, caught by the same self-review pass:
  `.v-input__slot` → `.v-field`, `.v-text-field__details` →
  `.v-input__details`, `.v-input--selection-controls` →
  `.v-selection-control` (confirmed via grepping `node_modules/vuetify/lib`
  for both old and new names). Same failure class as the `.v-list__tile` bug
  from Phase C's self-review.
- **`v-layout row wrap` has no direct Vuetify 3 equivalent** (the grid
  generally maps to `v-row`/`v-col`) — but `History.vue`'s usage had no
  `v-flex`/`v-col` children (just one `recycle-scroller`), so it was
  replaced with a plain `<div>` there rather than introducing `v-row`'s
  unrelated negative-margin behavior for a single non-grid child.
- **Typography/color utility classes changed shape, and this doesn't show up
  in any test** — `.title`/`.headline` (Vuetify 1/2 typography) don't exist
  in Vuetify 3 (→ `.text-h6`/`.text-h5`), and two-word color utilities
  (`grey lighten-2`) became single hyphenated classes (`.bg-grey-lighten-2`).
  `Index.vue`/`Downloads.vue`'s header title used `.title`; losing it
  silently dropped the line-height that kept the small "Next vX.X.X" subtitle
  from overlapping the line above — only visible on an actual page load, not
  in `pnpm test` (jsdom applies no real layout) or `pnpm run build` (compiles
  fine either way). This is the second reason the live-load check above
  matters: CSS-only regressions like this are invisible to every other check
  this project runs.
- **No test coverage at all for this directory** (`options_page/components/`
  outside `options/`, plus the 2 root `.vue` files) — component tests (#27)
  only ever covered the leaf `option-items` and `options/` trees, not this
  one. Wider gap than Phase C's (which at least had specs to update).
  Verification here is build + the live-browser check above, not
  `pnpm test`. Writing tests for this directory is its own follow-up, not
  part of a markup migration phase.

## Suggested sequencing

1. ~~Land the toolchain branch first~~ (done — Phase A, see the top of this doc).
2. Component tests landed in #27 (merged via #44, done) — `test/components/`
   now covers the leaf `option-items` and `options_page/components/options`
   trees by mounting the real `.vue` components with `shallowMountOption`,
   enforced by a coverage floor in `jest.config.js`; see `docs/testing.md`.
   `content_scripts/components` is still untested. Since it migrates last
   (step 5), that's the coverage gap left to close before this plan reaches it.
3. ~~Migrate the leaf `option-items`~~ (done — Phase B; 4 files, this doc
   previously said 5: `DownloadSaveMode.vue`, `ZipDownloads.vue`,
   `CombineRenameRules.vue`, `DontCreateWorkFolder.vue` is the full set). See
   "Phase B discovery" below for what landed alongside the markup change.
4. ~~Then `options_page/components/options`~~ (done — Phase C; 19 files, this
   doc previously said 20 — same count discrepancy as option-items above,
   never had a 20th file). See "Phase C notes" above.
5. ~~Then the rest of the options page~~ (done — Phase D; 19 files:
   `options_page/components/*.vue` (17) + `Index.vue` + `Downloads.vue`). See
   "Phase D notes" above.
6. **Dead-class cleanup pass, once Phase D is merged** — Phase D's live-browser
   check (see "Phase D notes") caught a dead `.title` selector and a stray
   `.v-list__tile` (the latter also found and fixed independently during
   Phase C's self-review) purely by *looking at the rendered page*; neither
   showed up in `pnpm test` or `pnpm run build`. Those are unlikely to be the
   only ones — audit every already-migrated file (Phase B + C + D: the leaf
   `option-items`, `options_page/components/options/`, and
   `options_page/components/` + the 2 root files) for scoped `<style>` blocks
   still targeting pre-migration Vuetify class names (`.v-list__tile`,
   `.v-list-tile*`, `.title`/`.headline`/`.subheading`, two-word color
   utilities like `grey lighten-2`, `.v-btn--small`/`.v-icon--right` and
   similar BEM-ish internal-class selectors whose Vuetify 3 name changed —
   cross-check against `node_modules/vuetify/lib/**/*.css`, not guesswork).
   A live extension load (build + manually load unpacked, or drive it via
   browser automation) is the only reliable way to catch these — static
   analysis and the test suite both miss them, as this phase demonstrated.
7. `content_scripts/components` (6) last — those render into Pixiv's own pages
   and are the hardest to verify. `PageSelector.vue`'s `this.$set`,
   `beforeDestroy` (see "Phase D notes"), `.sync` modifier (`:show.sync`),
   and `slot="..."` (two uses, `head`/`foot`) are all blockers here, and
   `App.vue` has the same `beforeDestroy` issue.

Budget this as a multi-week project, not a dependency bump.
