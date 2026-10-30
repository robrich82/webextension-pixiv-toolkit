---
name: add-settings-migration
description: Add a versioned settings migration under src/background/updates (register it and write its spec). Use when a change renames, removes, re-types or re-shapes a setting that existing installs already have in storage.local.
---

# Add a settings migration

## When one is needed

- **A new setting with a default** doesn't need a migration. Add it to `src/config/default.js`. A fresh install writes all the defaults, and existing installs read a missing key as its default wherever the code merges with `defaultSettings`. Check that the code reading the key actually does that merge.
- **A removed, renamed, re-typed or re-shaped setting** needs a migration, because the old value stays in storage until something rewrites it.

## How the migrations run

`Application.onInstalled` runs only on `update`, and only when the manifest version is above the stored `settings.version`. It runs every entry of `updates()` whose key is above the stored version, in the order they were inserted, one after another, then stores the manifest version. So:

- **The key is the version the change ships in**, which is the next unreleased version. Get the current version with `node -p "require('./package.json').version"` and the latest release with `gh release list --repo robrich82/webextension-pixiv-toolkit --limit 1`.
- **If a migration already exists for that unreleased version, extend it** rather than adding a second one. The registry is a `Map`, so two entries can't share a key.
- A key above the version that actually ships it keeps rerunning on every later update. `release-firefox` checks for this.
- A migration can run on settings that never had the old key, so it must be a safe no-op in that case.

## Steps

1. Create `src/background/updates/updateX_Y_Z.js` from `template.js` in this skill folder. Use the services through `app().getService('setting')`: `getSetting(keys)`, `getSettings()`, `updateSettings(obj)` and `removeSettings(keys)`. To drop a key, use `removeSettings`. Writing `undefined` over it leaves the key in storage.
2. Register it in `src/background/updates/index.js`: add the import and the `updates.set('X.Y.Z', updateX_Y_Z)` call **in ascending version order**. `test/updates.spec.js` asserts that order.
3. Write `test/updateX_Y_Z.spec.js` from `spec.template.js`. Cover at least:
   - the transformation itself;
   - every other setting being left alone;
   - a no-op when the old key was never there;
   - for renames, an existing value under the new key wins over the old one, or whatever rule the change decides on. State that rule in the migration's doc comment.
4. Update `src/config/default.js` if the default shape changed.
5. Run the specs: `pnpm exec cross-env NODE_ENV=test jest --config jest.config.js --coverage=false test/updateX_Y_Z.spec.js test/updates.spec.js`, then a full `pnpm test`.

Follow the doc-comment style of the existing migrations: one paragraph on what the change does to settings and why it's safe.
