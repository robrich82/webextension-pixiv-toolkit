# Vue 3 + Vuetify 3 migration (follow-up)

Scoping notes for the branch that clears the last standing advisory. Nothing
here is done — the toolchain branch deliberately stopped short of it.

## Why it is still outstanding

Vue 2.7 reached end of life in December 2023. `GHSA-5j4c-8p2g-v4jx` (ReDoS in
`parseHTML`) has no Vue 2 fix and never will. It is the sole remaining finding in
`pnpm audit`, reported over six dependency paths: directly against `vue`, and
transitively via `vue-i18n`, `vue-router`, `vuetify`, `vue-virtual-scroller` and
`vue-resize`.

**Practical exposure is low.** The advisory needs an attacker-controlled
*template*, and templates here are compiled at build time. The full Vue build
(`lib/vue.min.js`, which includes the runtime compiler) is loaded, so the parser
is present, but nothing feeds it untrusted markup. Treat this as EOL-and-audit
hygiene rather than an actively exploitable hole — which is why it was reasonable
to defer.

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

- **`new Vue()` → `createApp()`**, and `Vue.mixin(SuperMixin)` becomes an app-level
  mixin. `src/mixins/SuperMixin.js` is applied globally today.
- **Filters are removed** in Vue 3 — grep for `|` in templates.
- **`v-model` on components** changed prop/event names (`value`/`input` →
  `modelValue`/`update:modelValue`). This hits every `option-items` component.
- **`.sync` modifier removed**, folded into `v-model:foo`.
- **`$listeners` merged into `$attrs`**; `$children` removed.
- **Functional/`$scopedSlots`** API changes.
- **`vue-router` 3 → 4**: `new VueRouter()` → `createRouter()`, `mode: 'hash'` →
  `createWebHashHistory()`. Only `src/options_page/router` is affected.
- **`vue-i18n` 8 → 11**: `VueI18n` constructor → `createI18n`, and legacy mode
  must be opted into. Note `lib/vue-i18n.min.js` is loaded as a global external,
  so `config/webpack.background.config.js` copy patterns change too.
- **`vuedraggable` 2 → 4** (Vue 3 build) and **`vue-virtual-scroller` 1 → 2**.
  Both are used in `DownloadManager.vue` and `History.vue`.

## Build-side changes this unlocks

- `vue-loader` 15 → 17, and `@vue/compiler-sfc` replaces `vue/compiler-sfc`.
- Both dependency `overrides` in `package.json` can be deleted — the
  `@vue/component-compiler-utils` one becomes moot once vue-loader 17 is in, and
  it should be re-checked whether the `uuid` pin is still wanted.
- `vue-style-loader` can go; vue-loader 17 uses `style-loader`.

## Suggested sequencing

1. Land the toolchain branch first (done) so the build is not a moving target.
2. Add component tests before touching anything — there is currently **one** test
   file (`test/pathjoin.spec.js`, 7 assertions) and it covers a path utility, not
   UI. A 51-component rewrite with no UI test coverage is the main risk in this
   whole plan and should be addressed before, not after.
3. Migrate the leaf `option-items` (5 files) first to establish the patterns.
4. Then `options_page/components/options` (20), then the rest of the options page.
5. `content_scripts/components` (6) last — those render into Pixiv's own pages and
   are the hardest to verify.

Budget this as a multi-week project, not a dependency bump.
