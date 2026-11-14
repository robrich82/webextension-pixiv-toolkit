# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Pixiv Toolkit is a Manifest V3 browser extension (Chrome and Firefox) that downloads illustrations, ugoira, manga, novels and Fanbox posts from Pixiv, Pixiv Comic and Fanbox. This repo is the `robrich82` fork of `leoding86/webextension-pixiv-toolkit`. Point links, issues and PRs at the fork, not upstream.

## Commands

pnpm only (`engines.npm` refuses npm, and the `preinstall` hook refuses yarn and bun). Node is pinned in `mise.toml` and pnpm in `packageManager`, which mise reads; CI uses the same pins.

```bash
pnpm install
pnpm run build             # production build -> dist/chrome
pnpm run build:firefox     # production build -> dist/firefox
pnpm run dev               # watch build (dev:firefox); restart it after editing src/statics or reinstalling dependencies
pnpm test                  # Vitest, unit + components projects, with coverage thresholds
# Subsets need --coverage.enabled=false, or the global coverage thresholds fail the run
pnpm exec vitest run --coverage.enabled=false test/NameFormatter.spec.js
pnpm exec vitest run --coverage.enabled=false --project components
pnpm run test:e2e          # Playwright; needs `pnpm run build` first (loads dist/chrome)
pnpm run test:e2e:firefox  # node --test in real Firefox; needs `pnpm run build:firefox` first, prerequisites in docs/testing.md "Firefox"
```

There is no linter, formatter or type check. `eslint` and `eslint-plugin-compat` only check the built bundles against the browserslist floor, from `test/build.spec.js`. The `typescript` devDependency is there only so editors' typescript-language-server (and Claude's LSP tool) can find a tsserver, and it stays on 6.x because TypeScript 7 ships none. CI (`.github/workflows/ci.yml`) runs `pnpm audit`, `pnpm test`, both builds and the e2e tests.

`pnpm run release:firefox` (`scripts/release-firefox.js`) builds, signs through AMO and publishes a GitHub release with `updates.json`. AMO signs a given version only once, so don't run it without being asked.

## Architecture

`scripts/build.mjs` runs one Vite build per target into `dist/<platform>/`, after emptying it and copying `src/statics`, the `lib/` vendor files and the manifest. The targets:

- **background** (`src/background/`): the MV3 service worker on Chrome and an event page on Firefox.
- **content scripts** (`src/content_scripts/`): the in-page UI that is injected into Pixiv, Pixiv Comic and Fanbox.
- **options page** (`src/options_page/`): two pages, `index.html` for settings and `downloads.html` for the **download manager**.
- **popup**, plus `lib/locales.js`, which only exposes the locales as the `locales` global.

The pages and content scripts read `vue`, `vue-i18n` and `locales` (and Dexie, on the options pages) from globals that `lib/` scripts provide, rather than bundling them. Give a new `lib/` `<script>` tag `vite-ignore`, like the existing ones, or Vite warns that it can't bundle it. The background bundles everything.

Aliases: `@` → `src`, `@@` → `src/options_page`. Both are mirrored in `vitest.config.mjs`.

### Download flow

Since 6.0.0, downloads don't run in the content script. They run in the download manager page, which has to be open.

1. In the content script, `Detector` watches for URL changes and `PageAdapters/*` pick the site adapter. The adapter builds a resource from `src/modules/PageResource` using the parsers in `src/modules/Parser` (one folder per site).
2. `content_scripts/components/App.vue` makes sure the download manager tab is open, then sends `download:addDownload` with `resource.unpack()`.
3. The download manager (`DownloadsApplication.js` → `options_page/services/DownloadService.js`) runs the download task. Files are saved one at a time through `browser.downloads`, and ugoira is converted with FFmpeg.wasm in a worker.

### Messaging convention

`runtime.sendMessage({ to, action: 'service:method', args })`. `to: 'ws'` routes to the background `Application.onMessage`, and anything else with an `action` routes to the download manager. Each side resolves `service` through its own `ServiceProvider`: `history` → `HistoryService`, looked up in that side's `services/index.js`. Long-lived channels use `runtime.connect`, routed by port name in the background `Application.onConnect` to the background service of that name, if it extends `AbstractPortService`.

Payloads must survive structured clone. Firefox throws `DataCloneError` on Vue reactive proxies, so the existing code passes payloads through a JSON round-trip before sending.

### Chrome vs Firefox

`src/statics/manifest.json` is written for Chrome. The minimum browser versions come from `browserslist` in `package.json` (`docs/toolchain.md`, "browserslist"). `scripts/manifest.mjs` rewrites the manifest for Firefox:

- `service_worker` becomes `background.scripts`
- a gecko id, a self-hosted `update_url` and `strict_min_version` are added
- `options_page` becomes `options_ui`
- optional permissions are folded into `permissions`, except `downloads.shelf` (unsupported on Firefox)
- `version_name` is dropped

Cross-origin fetches (for example Fanbox) are made from the background, not from content scripts. `src/modules/Extension/browser.js` returns whichever `browser`/`chrome` global is available.

### Settings and migrations

Default settings live in `src/config/default.js`, and `SettingService` (one on each side) mirrors `storage.local` through `onChanged`. Renaming, removing or re-shaping a stored setting needs a versioned migration in `src/background/updates/`. The `add-settings-migration` skill has the rules.

UI strings are in `src/statics/_locales`. `src/statics/HISTORY_*` stops at upstream's v6.4.2. Fork releases use GitHub-generated notes instead.

## Testing

`docs/testing.md` is the reference. Key points:

- Vitest has two projects: `unit` (node environment, `test/**/*.spec.js`) and `components` (jsdom, `test/components/**`). Playwright files are named `*.e2e.js` so Vitest doesn't pick them up.
- `@/modules/Extension/browser` is mapped to the in-memory fake in `test/doubles/browser.js`. Its test controls are under `browser._fake` (`reset`, `flush`, `addTab`, …), and it's reset before every test. Specs that open a port need `await browser._fake.flush()`.
- Services are singletons that register listeners in their constructor. Clear `Service.instance = undefined` in `beforeEach` when a spec needs live listeners.
- `coverage.thresholds` in `vitest.config.mjs` is a ratchet with per-directory floors. A new untested file can fail `pnpm test`, so either cover it or lower the floor in the same PR and say why.

Other docs: `docs/toolchain.md` (build toolchain) and `docs/help.md` (user help, linked from the ugoira options; keep its ffmpeg presets in step with `src/config/default.js`). Track open work in GitHub issues, not in `docs/`.
