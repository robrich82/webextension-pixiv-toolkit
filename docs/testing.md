# Tests

`pnpm test` runs Vitest over every `*.spec.js` under `test/`, with coverage
collected from `src/**/*.{js,vue}`. `vitest.config.mjs` defines two projects:
`unit` (everything under `test/` except `test/components/`, in the `node`
environment; see below for why) and `components` (`test/components/**/*.spec.js`,
under `jsdom`, covered in its own section further down). Vite transforms both
specs and sources, so everything is ESM.

`resolve.alias` mirrors the webpack aliases, so a spec can import source files
by the same `@/` and `@@/` paths the source itself uses. It also stands in for
webpack's `locales` external, and `define` sets `PRESET_BROWSER` to `chrome`.

To run a subset, use `pnpm exec vitest run <spec>` or `--project components`.
Coverage is always on, and a subset run fails the floors below, so add
`--coverage.enabled=false`.

## The coverage floor

`coverage.thresholds` in `vitest.config.mjs` fails the run — and so CI, which just
calls `pnpm test` — when coverage drops below where it already is. It is a
ratchet, not a target: the numbers are set a hair under the current ones, so
nothing can quietly regress, and they get raised whenever a change clears them
by a useful margin.

The tested parts of `src` each get their own glob, because one global number
would let a well-tested directory pay for an untested one; the config lists
them. A glob pools its files into one number unless it sets `perFile: true`,
and its files still count toward the global floor, so the global floor is the
whole-repo number. A key that matches no file passes silently, so rename the
key when you move or rename the file it names.

A PR that adds a large untested file will trip the global floor. That is the
mechanism working: either cover the file or, if the change genuinely cannot be
tested yet, lower the floor in the same PR and say why.

## The extension API double

`src/modules/Extension/browser.js` hands back whichever `chrome`/`browser`
global the extension is running against. Under test there is no such global, so
anything touching `browser.storage`, `browser.runtime`, `browser.downloads` or
`browser.tabs` was untestable.

`test/doubles/browser.js` is an in-memory stand-in, and `resolve.alias` in
`vitest.config.mjs` points `@/modules/Extension/browser` at it. A spec gets it
just by importing the code under test — there is no per-spec `vi.mock` call:

```js
import browser from './doubles/browser';
import FileSystem from '@/options_page/modules/FileSystem';

test('downloads under the formatted name', async () => {
  await FileSystem.getDefault().saveFile({ url, filename: '12345_sunset.png' });

  expect(browser._fake.lastDownload()).toMatchObject({ filename: '12345_sunset.png' });
});
```

What it covers: `storage.local` with working `onChanged` events, `runtime`
messaging (`sendMessage`/`onMessage`) and ports (`connect`/`onConnect`),
`downloads` including `onDeterminingFilename`, `tabs`, `i18n`, `action`,
`permissions`, `notifications` and `windows.update`. `webRequest` is absent
because nothing in `src` uses it any more.

Two behaviours of the real APIs are reproduced on purpose, because the codebase
depends on both:

- Every async call returns a promise **and** invokes an optional trailing
  callback. `SettingService` wraps callbacks in promises while `DownloadService`
  awaits the same kind of call directly.
- `runtime.onConnect` is dispatched on a later tick, as the browser does, so a
  port that posts immediately cannot out-run the listeners the other side
  attaches after `connect()` returns. Specs that open a port need
  `await browser._fake.flush()` before asserting.

Every API is a `vi.fn`, so calls can be asserted with the usual matchers, and
the stored state — `storage.local.items`, `downloads.items`, `tabs.items`,
`runtime.ports` — is readable directly.

### Setting up and driving the fake

Test-only controls live under `browser._fake`, away from the real API surface:
`reset()`, `flush()`, `addTab()`, `setCurrentTab()`, `setUILanguage()`,
`setManifest()`, `setLastError()`, `determineFilename()` and `lastDownload()`.
`state` is the fake's own internal store (manifest, granted permissions, tab
and window counters); a few specs reach into it directly — e.g.
`browser._fake.state.grantedPermissions = {...}` — where no dedicated setter
exists yet.

`test/setup/extensionGlobals.js` runs `reset()` before every test, so a spec
starts with empty stores, no listeners and no recorded calls. That file also
assigns the same fake to the `chrome`, `browser`, `self` and `window` globals,
for the code that reaches for them directly — `chrome.i18n.getUILanguage()` in
`UIApplication.js` and `downloads.js`, `window.chrome` in
`modules/Browser/Browser.js`.

### Singletons

Most services are singletons that register their listeners in the constructor,
and `reset()` clears those listeners. A spec that needs a live listener should
clear the instance first:

```js
beforeEach(() => {
  SettingService.instance = undefined;
  service = SettingService.getService();
});
```

### Why not an off-the-shelf mock

Both candidates were installed and probed against what this codebase actually
needs. Results, `jest-webextension-mock` 4.2.0 and `sinon-chrome` 3.0.1 via its
`sinon-chrome/webextensions` entry:

| | `jest-webextension-mock` | `sinon-chrome/webextensions` |
| --- | --- | --- |
| `get` after `set` | returns what was stored | `undefined` — no state |
| promise **and** callback on one call | one or the other: a callback makes the call return `undefined` | neither; stubs return `undefined` |
| `storage.onChanged` fires on a write | no — spy only, and no trigger helper | no — but `.trigger()` fires it by hand |
| `runtime.connect` port pairs | port object, but unpaired: `onConnect` never fires and `postMessage` delivers nothing | `connect()` returns `undefined` |
| `runtime.sendMessage` reaches `onMessage` | yes | no |
| `downloads.download` | spy, records the request | stub, records the request |
| `tabs.get` | yields `{}` — no tab store | `undefined` |

`sinon-chrome` is a stub library by design: you script each call with
`.returns`/`.yields` and fire events with `.trigger()`, so an assertion mostly
checks what the stub was told to say.

`jest-webextension-mock` gets further — its storage is genuinely stateful and
`sendMessage` is routed — but the three things this codebase leans on hardest
are the ones it does not do. `SettingService` mirrors settings into the
application through a live `onChanged` listener; `AbstractPortService` needs
a connected port pair; and `SettingService` passes
callbacks where `DownloadService` awaits the same kind of call, so both
conventions have to work on one call. Adding those on top means re-implementing
most of this file anyway, over a storage implementation we would then be half
overriding — so the fake is hand-rolled and adds no dependency.

## The v5 PouchDB store

`src/background/modules/migrateIllustHistory.js` reads v5's PouchDB store
straight from IndexedDB; the library no longer ships. Its specs write the store
into fake-indexeddb with `test/helpers/pouchdbV5Store.js`: `restoreDatabases()`
recreates a real store dumped from PouchDB 7.2.2
(`test/fixtures/pouchdbV5/illustHistories.json`, regenerated by `generate.js`
beside it), and `writeStore(docs)` builds simpler ones in the same layout.
Delete them in `afterEach` with `deletePouchDatabases()`.

## Dexie repositories

Specs that touch Dexie or IndexedDB import `test/helpers/fakeIndexedDb.js` before anything
that loads it, so they run against a real in-memory IndexedDB. The helper also
gives jsdom the `structuredClone` that fake-indexeddb needs. `Db` and each repo
are singletons: clear `Db.instance` and the repo's `instance` in `beforeEach`,
and call `Db.getDb().database.delete()` in `afterEach`.

## DOM code, without jsdom

Everything runs under the `node` test environment. `CopyStr`, the one module
in `src/modules/Util` that reaches for the DOM, is covered with a small
`document` double declared in its own spec, assigned to `globalThis` in
`beforeEach` and deleted again afterwards.

jsdom was considered and skipped for it: `execCommand('copy')` is absent there,
so a jsdom run would still be asserting against a stub, only one someone else
wrote. Component specs are a different case — see "Component tests" below,
which does use jsdom, deliberately, for the `components` project.

So the spec asserts the sequence rather than the result: that the copy node is
still in the document when `execCommand` runs. That is a real regression this
codebase could suffer, and it needs no browser to catch.

## Component tests

`test/components/*.spec.js` covers the `option-items` and
`options_page/components/options` `.vue` components — the leaf option
components with real logic, and the ones `docs/vue3-migration.md` migrates
first. It's the `components` project (see above): the `jsdom` environment,
`.vue` files compiled by `@vitejs/plugin-vue`, and `@vue/test-utils@2` (the
Vue 3 major). Vuetify 3's components each import their own stylesheet, which
Node can't load, so `server.deps.inline` has Vite transform Vuetify instead of
handing it to Node. `test/setup/jsdomGlobals.js` supplies the globals Vuetify
reads at import or mount time that jsdom lacks (`CSS`, `ResizeObserver`,
`visualViewport`); its comments say where each is used. It also fails any
test that raises a Vue warning, so fix the warning's cause rather than
silencing it.

### Mounting: `test/helpers/mountOptionComponent.js`

Every options-page component reads `this.browserItems` and calls
`this.tl(...)`, both added by the global `SuperMixin` (`browserItems` resolves
`this.$root.globalBrowserItems`; `tl` wraps `this.$t`). `mountOptionComponent`
supplies both:

- `global: { plugins: [vuetify], mixins: [SuperMixin, browserItemsMixin] }` —
  `@vue/test-utils@2` removed `createLocalVue`/`parentComponent` entirely, and
  a component mounted with no parent is *not* its own `$root` the way it was
  under `@vue/test-utils@1` (confirmed empirically, not documented by VTU).
  A global mixin's `data()` does reach that internal root, though, so
  `browserItemsMixin` (built fresh per `shallowMountOption()` call, closing
  over that call's `browserItems`) is what actually seeds it — see the
  comment in `mountOptionComponent.js` for the full reasoning.
- `global.mocks: { $t: key => key }` — a passthrough, not a real vue-i18n
  instance, since these specs assert behaviour, not translated copy.
- `createAppVuetify()` (the same factory the two production entry points use,
  in `src/options_page/vuetify.js` — see `docs/vue3-migration.md`'s "Phase B
  discovery") is built once at module load and reused for every mount in the
  file, matching the old `localVue` pattern's intent — but for a different
  reason: Vue 3's Vuetify doesn't warn on multiple instances the way Vue 2's
  did, it's just wasteful to rebuild per mount. It's real Vuetify 3
  component registration, not a no-op — see the next paragraph for what that
  changed.

`shallowMountOption` auto-stubs every Vuetify component except `v-text-field`
and the `VInput`/`VField` it is built from. A stub renders its props as
attributes, and Vue warns when one sets `prefix`, a read-only DOM property;
`v-select` and `v-textarea` have that prop too. Since Phase B,
Vuetify's real components are actually registered (`createAppVuetify()`), so
this stubbing is what makes testing these components tractable at all — a
real `v-select` needs a full DOM layout pass to open, and these specs only
care about the surrounding component's own logic (`computed`, `watch`,
`created`/`beforeMount`, methods), not Vuetify's rendering. It also sets
`global.renderStubDefaultSlot: true`, because a stub's *default* slot would
otherwise swallow any descendant component nested inside a Vuetify layout tag
(e.g. a custom component inside `<v-list>`), making it unreachable via
`find`/`findComponent`. That option only reaches the default slot, though — a
migrated component's `#title`/`#subtitle`/`#append` *named* slots (see
`option-items/*.vue`) never render under `shallowMount`, stub or not, so a
`shallowMount` spec cannot assert on that component's actual rendered markup.
Prefer `wrapper.vm.*` state for behavior, as before, but pin a migrated
template's slot names and prop mappings (e.g. `v-select`'s `item-title`) with
one real `mountOption()` (also exported by `mountOptionComponent.js`) per
established pattern — see `DownloadSaveMode.spec.js` for the shape. One
caveat of `renderStubDefaultSlot`: it also renders a stubbed dialog/menu's
body regardless of visibility, so a future "X is not visible" assertion needs
a real mount too, not a shallow one. That mount also needs `attachTo:
document.body`: jsdom computes no styles for a detached element, so
`isVisible()` is always true there (see `App.spec.js`).

The extension API double (`test/doubles/browser.js`, see above) is reused
as-is: a spec imports it directly and the component's own
`@/modules/Extension/browser` import resolves to the same instance through
the alias.

### Two gotchas specific to these components

*(Recorded against Vue 2's scheduler internals, pre-dating the Vue 3 migration's
Phase A. The mounted components are still Vue 2-style Options API code running
unmigrated, and the batching behaviour they describe is a Vue-level concern,
not a `@vue/test-utils` one — but Vue 3's scheduler (`queueJob`/`flushJobs`)
replaced Vue 2's `flushSchedulerQueue`, and `@vue/test-utils@2` no longer
shares one `localVue`/scheduler across a whole file's mounts the way `@vue/
test-utils@1` did. Re-verify before relying on the specifics below.)*

**A watcher can echo its own `created()`/`beforeMount()` assignment.** Several
components initialise a watched data property from `browserItems` in
`created()` — `this.pageNumberLength = this.browserItems.globalTaskPageNumberLength`,
say — which is itself a change the watcher is queued to persist on the next
tick. A spec that changes that same property in the *same* tick as mount,
before that queued flush runs, can see it cancel out: Vue's watcher only
compares the value at flush time against the value before the whole batch, so
mount-then-immediately-set-back-to-the-original-default never calls the
callback at all. The fix is mechanical: `await wrapper.vm.$nextTick()` once
right after mounting, before making the change under test, so the echo settles
on its own. (`DownloadSaveMode`'s revert-on-invalid-input watcher relies on
the same batching from the other direction: setting `this.value` back inside
the watcher's own callback re-queues it, and the second run's write is the one
that actually lands.)

**A stale event-handler reference can wedge Vue's scheduler for the rest of
the file.** A template `@event="someMethod"` naming a method the component
doesn't actually define is a dead reference that only bites once that
component re-renders: Vue's listener-patch throws (`Cannot read properties of
undefined (reading '_wrapper')`) inside the *render* watcher — not a user
watcher, so the exception isn't caught by Vue's `handleError` path and
escapes `flushSchedulerQueue` before it resets. Because the scheduler is
shared by every component on the same `localVue`, this leaves it wedged:
later watchers (in this component or any other, for the rest of the test
file) get queued but never flushed again, which reads as "reactivity silently
stopped working" with no error at the call site that broke it. The
workaround, if a spec hits this on a component you can't fix, is to mount it
with a `methods:` override supplying a no-op handler for the dead reference.
If a future spec's watcher assertions mysteriously stop firing with no thrown
error, a stale `@event` handler reference recently triggered elsewhere in the
same file is worth checking before anything else.

## End-to-end tests

`pnpm run test:e2e` runs Playwright over `e2e/*.e2e.js` (not `.spec.js`, which
Vitest would claim). Each test launches Playwright's full Chromium with
`dist/chrome` loaded, so run `pnpm run build` first; it tests whatever is in
`dist/`, stale or not. The `channel: 'chromium'` in `e2e/fixtures.js` is
load-bearing: without it Playwright runs its headless shell, which can't load
extensions, and branded Chrome ignores `--load-extension`.

Pixiv is never contacted. `mockPixiv()` in `e2e/fixtures.js` serves mapped
`/ajax/...` paths from `test/fixtures` and 404s the rest, returns a blank
document for every other `www.pixiv.net` page and a 1x1 PNG for unmapped
`i.pximg.net` paths, and aborts all other http(s) requests. The fixtures also
expose the extension's `serviceWorker`, for reading `chrome.downloads` state,
and its `extensionId`, for opening extension pages.

Two limits worth knowing before adding a test:

- Downloads made through `chrome.downloads` fire no Playwright `download`
  event and are saved under Playwright's artifact ids, so a test can check
  a download's state, mime and size but not the filename on disk. Filename
  formatting is covered by the `NameFormatter` unit tests instead.
- Firefox is not covered: Playwright cannot load an extension into Firefox.
