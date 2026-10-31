---
name: add-settings-migration
description: Add a versioned settings migration under src/background/updates (register it and write its spec). Use when a change adds a setting existing installs need, or renames, removes, re-types or re-shapes one they already have in storage.local.
---

# Add a settings migration

## When one is needed

Settings are read raw from `storage.local` everywhere (e.g. `background/Application.js`, `options_page/DownloadsApplication.js`, `content_scripts/Application.js`, `popup_page/main.js`). Nothing merges them with `defaultSettings`.

- **A new setting**: add it to `src/config/default.js`. Fresh installs get it, but existing installs read it as `undefined`. Either fall back where it's read, or add a migration that writes the default when the key is absent.
- **A removed, renamed, re-typed or re-shaped setting**: needs a migration, because the old value stays in storage until something rewrites it. Delete a renamed or removed key from `default.js` rather than marking it `@deprecated`, or fresh installs will keep writing it.

## How the migrations run

`Application.onInstalled` (on install or update) writes `defaultSettings` when there is no stored `settings.version`. Otherwise, when the manifest version is above the stored one, it runs every entry of `updates()` keyed above the stored version, in insertion order, then stores the manifest version.

- **Fresh installs are stored at `6.0.0`** (`default.js` `version`), so their first update runs **every** migration keyed above 6.0.0. A migration must be safe on settings that are already in the new shape, or that never had the old key.
- **The key is the version the change ships in**: `package.json`'s version (`node -p "require('./package.json').version"`) if it is above the latest release (`gh release list --repo robrich82/webextension-pixiv-toolkit --limit 1`), otherwise the version the next bump will set.
- **If that version already has a migration, extend it.** The registry is a `Map`, one entry per key.
- A key above the version that actually ships it reruns on each update until the stored version reaches it. The `release-firefox` skill checks for this.

## Steps

1. Create `src/background/updates/updateX_Y_Z.js` from `template.js` in this skill folder. Use `app().getService('setting')`: `getSetting(keys)`, `getSettings()`, `updateSettings(obj)`, `removeSettings(keys)`. To drop a key use `removeSettings`; writing `undefined` over it leaves the key in storage.
2. Register it in `src/background/updates/index.js` (the import and `updates.set('X.Y.Z', updateX_Y_Z)`) **in ascending version order**. `test/updates.spec.js` asserts that order.
3. Write `test/updateX_Y_Z.spec.js` from `spec.template.js`. Cover:
   - the transformation itself;
   - every other setting being left alone;
   - a no-op when the old key was never there;
   - for renames, which value wins when both keys exist. State the rule in the migration's doc comment.
4. Run `pnpm test`.
