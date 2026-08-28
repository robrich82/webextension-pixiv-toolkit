# Tests

`npm test` runs Jest over every `*.spec.js` under `test/`, with coverage
collected from `src/**/*.js`. Configuration lives in `jest.config.json`; the
`test` block of `.babelrc` compiles to CommonJS for the current Node.

The webpack aliases are mirrored into `moduleNameMapper`, so a spec can import
source files by the same `@/` and `@@/` paths the source itself uses.

## The coverage floor

`coverageThreshold` in `jest.config.json` fails the run — and so CI, which just
calls `npm test` — when coverage drops below where it already is. It is a
ratchet, not a target: the numbers are set a hair under the current ones, so
nothing can quietly regress, and they get raised whenever a change clears them
by a useful margin.

There are three groups, because one global number would let a well-tested
directory pay for an untested one:

| Group | statements | branches | functions | lines |
| --- | --- | --- | --- | --- |
| `src/modules/Util/` | 95 | 86 | 100 | 99 |
| `src/modules/Parser/` | 77 | 66 | 67 | 76 |
| everything else | 6.7 | 6.2 | 6.6 | 6.7 |

`Util` and `Parser` are the parts that are actually tested, so they are held to
a real standard; the global row is the rest of `src`, which is mostly untested
UI, services and download tasks. Note that Jest removes a path group's files
from the global pool, so the global row is *not* the whole-repo number — that
currently reads around 31% statements.

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

jsdom was considered and skipped. It implements none of what those three
actually depend on: `execCommand('copy')` is absent, images never load, and
`canvas.getContext('2d')` returns `null` without `node-canvas` — a compiled
dependency — behind it. A jsdom run would still be asserting against stubs,
only stubs someone else wrote and this project would then be carrying.

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
