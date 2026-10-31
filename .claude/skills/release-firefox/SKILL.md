---
name: release-firefox
description: Build, sign through AMO and publish a self-hosted Firefox release of this fork, after pre-flight checks. User-invoked only.
disable-model-invocation: true
---

# Release Firefox

`pnpm run release:firefox` (`scripts/release-firefox.js`) builds `dist/firefox`, signs it with `web-ext sign --channel unlisted`, and publishes a GitHub release on `robrich82/webextension-pixiv-toolkit` with the `.xpi` and an updated `updates.json`. AMO signs a given version **once**, and the release is public, so every check below has to pass before you run the script.

## Pre-flight

Run these from the **main checkout**, not a worktree. Releases are cut from `main`.

1. **The tree is clean and up to date with `origin/main`.**
   `git fetch origin && git status -sb` shows `## main...origin/main` with no changes. If it doesn't, stop.
2. **The version has been bumped.** Releases so far have been a `chore/release-X.Y.Z` PR that changes only `package.json` `version`, merged before releasing. Compare it with the latest release:
   `node -p "require('./package.json').version"` and `gh release list --repo robrich82/webextension-pixiv-toolkit --limit 1`
   If the version is not higher than the latest release, stop and offer to open the bump PR.
3. **Settings migrations are covered.** Every key in `src/background/updates/index.js` must be `<=` the new version (see `add-settings-migration`).
4. **CI is green on `main`.** Run `gh run list --repo robrich82/webextension-pixiv-toolkit --branch main --limit 1`. If you want to double-check locally, run `pnpm test`.
5. **Credentials.** `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` must be set in the user's shell. Check only that they are set (`[ -n "$WEB_EXT_API_KEY" ]`). Never print them or pass them as arguments. `gh auth status` must show access to the fork.
6. **VPN.** Ask whether ProtonVPN is on. It makes the TLS resets against addons.mozilla.org worse, and a reset after the upload can't be retried (see below). Offer to wait while it's turned off.

Summarise the results of all six checks and get an explicit go-ahead before going further.

## Release

```bash
pnpm run release:firefox
```

Run it in the background (`run_in_background`). The script sets no timeout, and AMO approval can take longer than the Bash tool's 10-minute foreground limit.

**Don't rerun after a failure without checking first.** web-ext creates the version on AMO once the upload passes validation, before approval and download. From then on the script's own sign retries fail on the duplicate version, and its retry comment (which says otherwise) is stale. The script also deletes `web-ext-artifacts/` when it starts.
- If `Signed:` was printed, the `.xpi` is in `web-ext-artifacts/`. Copy it somewhere safe.
- If the AMO developer hub lists the version but there's no `.xpi`, download the signed file from there.
- Either way, finish by hand. Mirror the script's steps after `== Sign ==` in `scripts/release-firefox.js`:
  - rename the file to `pixiv-toolkit-firefox-<version>.xpi`;
  - take its sha256;
  - **merge** a new entry into the previous release's `updates.json` (a fresh file drops update paths for older versions);
  - run `gh release create <version> --title v<version> --generate-notes <xpi> <updates.json>`.
- Only rerun if AMO has no record of the version.

## Afterwards

- Report the release URL from the script's output and the `.xpi`'s sha256.
- Confirm that `updates.json` on the new release lists the new version:
  `gh release download <version> --repo robrich82/webextension-pixiv-toolkit -p updates.json -O -`
