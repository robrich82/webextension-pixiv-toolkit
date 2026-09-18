# Vue 3 + Vuetify 3 migration (follow-up)

Scoping notes for the branch that clears the last standing advisory.

**Phase A (the toolchain bump + every global integration point) has landed**
on `feature/vue3-vuetify3-migration-26` — see that branch's `build/
vue3-toolchain-bump-26` PR. `.vue` component templates are still on Vuetify 1.5
markup; the phases below this point are what's left.

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
| `v-list-tile-title` | 67 | `v-list-item-title` |
| `v-list-tile-action` | 60 | `v-list-item-action` (+ `append`/`prepend` slots) |
| `v-btn` | 42 | `v-btn`, but `flat`→`variant="text"`, `depressed`→`variant="flat"` |
| `v-list-tile-sub-title` | 40 | `v-list-item-subtitle` |
| `v-list` | 29 | `v-list` |
| `v-icon` | 26 | `v-icon` — icon set config changes (`mdi-` prefixes) |
| `v-select` | 25 | `v-select` — `items` item-text/item-value → `item-title`/`item-value` |
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

## Suggested sequencing

1. ~~Land the toolchain branch first~~ (done — Phase A, see the top of this doc).
2. Component tests landed in #27 (merged via #44, done) — `test/components/`
   now covers the leaf `option-items` and `options_page/components/options`
   trees by mounting the real `.vue` components with `shallowMountOption`,
   enforced by a coverage floor in `jest.config.js`; see `docs/testing.md`.
   `content_scripts/components` is still untested. Since it migrates last
   (step 5), that's the coverage gap left to close before this plan reaches it.
3. Migrate the leaf `option-items` (4 files — this doc previously said 5;
   `DownloadSaveMode.vue`, `ZipDownloads.vue`, `CombineRenameRules.vue`,
   `DontCreateWorkFolder.vue` is the full set) first to establish the patterns.
4. Then `options_page/components/options` (20), then the rest of the options page
   — `DownloadManager.vue`'s `this.$set` calls (see above) are a hard blocker
   somewhere in this phase, not just a markup update.
5. `content_scripts/components` (6) last — those render into Pixiv's own pages
   and are the hardest to verify. `PageSelector.vue`'s `this.$set` calls are the
   same kind of blocker here.

Budget this as a multi-week project, not a dependency bump.
