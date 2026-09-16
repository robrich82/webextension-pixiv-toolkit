# Tests

`pnpm test` runs Jest over every `*.spec.js` under `test/`, with coverage
collected from `src/**/*.js` and `src/**/*.vue`. Configuration lives in
`jest.config.js`, split into two Jest `projects` sharing a common `base`:
`unit` (everything under
`test/`, except `test/components/`, running in the `node` environment — see
below for why) and `components` (`test/components/**/*.spec.js`, running under
`jsdom`, covered in its own section further down). The `test` block of
`.babelrc` compiles to CommonJS for the current Node.

The webpack aliases are mirrored into `moduleNameMapper` for both projects, so
a spec can import source files by the same `@/` and `@@/` paths the source
itself uses.

## The coverage floor

`coverageThreshold` in `jest.config.js` fails the run — and so CI, which just
calls `pnpm test` — when coverage drops below where it already is. It is a
ratchet, not a target: the numbers are set a hair under the current ones, so
nothing can quietly regress, and they get raised whenever a change clears them
by a useful margin.

There are four groups, because one global number would let a well-tested
directory pay for an untested one:

| Group | statements | branches | functions | lines |
| --- | --- | --- | --- | --- |
| `src/modules/Util/` | 95 | 86 | 100 | 99 |
| `src/modules/Parser/` | 77 | 66 | 67 | 76 |
| `src/options_page/components/options/` | 88 | 78 | 95 | 88 |
| everything else | 7.1 | 6.5 | 7.0 | 7.0 |

`Util`, `Parser` and the options components are the parts that are actually
tested, so they are held to a real standard; the global row is the rest of
`src`, which is mostly untested UI, services and download tasks. Note that
Jest removes a path group's files from the global pool, so the global row is
*not* the whole-repo number — that currently reads around 36% statements.

A PR that adds a large untested file will trip the global floor. That is the
mechanism working: either cover the file or, if the change genuinely cannot be
tested yet, lower the floor in the same PR and say why.

## The extension API double

`src/modules/Extension/browser.js` hands back whichever `chrome`/`browser`
global the extension is running against. Under Jest there is no such global, so
anything touching `browser.storage`, `browser.runtime`, `browser.downloads` or
`browser.tabs` was untestable.

`test/doubles/browser.js` is an in-memory stand-in, and `moduleNameMapper`
points `@/modules/Extension/browser` at it. A spec gets it just by importing the
code under test — there is no per-spec `jest.mock` call:

```js
const browser = require('./doubles/browser').default;
const FileSystem = require('../src/options_page/modules/FileSystem').default;

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

Every API is a `jest.fn`, so calls can be asserted with the usual matchers, and
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
application through a live `onChanged` listener; `AbstractPortService` and
`DownloadRecordPort` need a connected port pair; and `SettingService` passes
callbacks where `DownloadService` awaits the same kind of call, so both
conventions have to work on one call. Adding those on top means re-implementing
most of this file anyway, over a storage implementation we would then be half
overriding — so the fake is hand-rolled and adds no dependency.

## DOM and binary code, without jsdom

Everything runs under the `node` test environment. The modules in
`src/modules/Util` that reach for the DOM — `CopyStr`, `getImageSize`,
`getCanvasFromDataURI` — are covered with small doubles declared in their own
specs (`document`, `Image`, a 2d context, `FileReader` for
`PackageFileReader`), assigned to `globalThis` in `beforeEach` and deleted
again afterwards.

jsdom was considered and skipped for these three. It implements none of what
they actually depend on: `execCommand('copy')` is absent, images never load,
and `canvas.getContext('2d')` returns `null` without `node-canvas` — a
compiled dependency — behind it. A jsdom run would still be asserting against
stubs, only stubs someone else wrote and this project would then be carrying.
Component specs are a different case — see "Component tests" below, which
does use jsdom, deliberately, for the `components` Jest project.

So the specs assert the sequence rather than the result: that the copy node is
still in the document when `execCommand` runs, that `getImageSize` reads
`width`/`height` on `load` and not before, that `getCanvasFromDataURI` sizes the
canvas and draws over the whole of it. Each of those is a real regression this
codebase could suffer; none of them needs a browser to catch.

`APNG` needs no doubles at all. It is UPNG plus pako, working on RGBA
`ArrayBuffer`s with no canvas anywhere, so `APNG.spec.js` encodes frames and
decodes them again through UPNG's own decoder and compares pixels. Frames there
are 32x32 for a reason the spec records: the encoder sizes its scratch buffer
from the pixel data alone, and a 4x4 animation overflows it.

## Component tests

`test/components/*.spec.js` covers the `option-items` and
`options_page/components/options` `.vue` components — the leaf option
components with real logic, and the ones `docs/vue3-migration.md` recommends
migrating first (not yet started). It's Jest's `components` project (see above):
`testEnvironment: "jsdom"`, `.vue` files transformed by `@vue/vue2-jest`
(the actively maintained fork of `vue-jest` for Vue 2, unlike the archived
`vue-jest@3`/`4`), and `@vue/test-utils@1` (the last major with Vue 2
support — `@vue/test-utils@2`+ is Vue 3 only).

`vue-jest`/`@vue/vue2-jest` compile templates through the real
`vue-template-compiler`, not the `vue/compiler-sfc` Vue 2.7 bundles — vue-loader
15 only reaches for `vue/compiler-sfc` when it's present, but `@vue/vue2-jest`
imports `vue-template-compiler` unconditionally, so it's a devDependency here
purely for Jest even though the webpack build doesn't need it. It's pinned to
the same version as `vue` (version mismatches between the two throw at
require time).

### Mounting: `test/helpers/mountOptionComponent.js`

Every options-page component reads `this.browserItems` and calls
`this.tl(...)`, both added by the global `SuperMixin` (`browserItems` resolves
`this.$root.globalBrowserItems`; `tl` wraps `this.$t`). `mountOptionComponent`
supplies both:

- A single `localVue` built once at module load — `createLocalVue()`,
  `.use(Vuetify)`, `.mixin(SuperMixin)` — and reused for every mount in the
  file. Calling `.use(Vuetify)` again on a *fresh* `createLocalVue()` per test
  logs a "Multiple instances of Vue detected" warning (vuetifyjs/vuetify#4068);
  reusing one `localVue` avoids it and is faster besides.
- `mocks: { $t: key => key }` — a passthrough, not a real vue-i18n instance,
  since these specs assert behaviour, not translated copy.
- A `parentComponent` whose `data()` carries `globalBrowserItems`. This is the
  only way vue-test-utils gives a mounted component a `$root` distinct from
  itself — `mount(Component)` alone makes the component its own root, so
  `browserItems` would read `undefined`.

`shallowMountOption` auto-stubs every Vuetify component, which is what makes
testing these components tractable at all — Vuetify 1.5's real `v-select`
needs a full DOM layout pass to open, and these specs only care about the
surrounding component's own logic (`computed`, `watch`, `created`/
`beforeMount`, methods), not Vuetify's rendering. There is no real-`mount`
variant — nothing here needs actual Vuetify DOM output, and adding one back
is a three-line change if that changes.

The extension API double (`test/doubles/browser.js`, see above) is reused
as-is: a spec imports it directly and the component's own
`@/modules/Extension/browser` import resolves to the same instance via
`moduleNameMapper`.

### Two gotchas specific to these components

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
the file.** `UgoiraConverterOption.vue`'s template has
`<v-select @change="onUgoiraConvertToolChangeHandler">`, but no such method
exists on the component (a pre-existing dead reference — confirmed by grep,
not fixed here since this issue is about adding coverage, not behaviour
changes). Once that component actually re-renders with the handler still
`undefined`, Vue's listener-patch throws (`Cannot read properties of
undefined (reading '_wrapper')`) inside the *render* watcher — not a user
watcher, so the exception isn't caught by Vue's `handleError` path and
escapes `flushSchedulerQueue` before it resets. Because the scheduler is
shared by every component on the same `localVue`, this leaves it wedged:
later watchers (in this component or any other, for the rest of the test
file) get queued but never flushed again, which reads as "reactivity silently
stopped working" with no error at the call site that broke it.
`UgoiraConverterOption.spec.js` works around it with a `methods:` mount
override supplying a no-op handler — see the comment on `mountConverter`
there. If a future spec's watcher assertions mysteriously stop firing with no
thrown error, a stale `@event` handler reference recently triggered is worth
checking before anything else.
