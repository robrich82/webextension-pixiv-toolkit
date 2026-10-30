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
3. **Settings migrations are covered.** Every key in `src/background/updates/index.js` must be `<=` the new version. A key above the version that ships it reruns on every later update until the stored version catches up.
4. **CI is green on `main`.** Run `gh run list --repo robrich82/webextension-pixiv-toolkit --branch main --limit 1`. If you want to double-check locally, run `pnpm test`.
5. **Credentials.** `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` must be set in the user's shell. Check only that they are set (`[ -n "$WEB_EXT_API_KEY" ]`). Never print them or pass them as arguments. `gh auth status` must show access to the fork.
6. **VPN.** Ask whether ProtonVPN is on. It makes the TLS resets against addons.mozilla.org worse. The script retries signing 5 times, but offer to wait while it's turned off.

Summarise the results of all six checks and get an explicit go-ahead before going further.

## Release

```bash
pnpm run release:firefox
```

Run it in the foreground. It has a 10-minute timeout and signing can be slow. If signing still fails after the retries, the version has **not** been used up on AMO unless a signing job actually completed, so it's safe to run again. Check `web-ext-artifacts/` and the AMO developer hub before retrying.

## Afterwards

- Report the release URL from the script's output and the `.xpi`'s sha256.
- Confirm that `updates.json` on the new release lists the new version:
  `gh release download <version> --repo robrich82/webextension-pixiv-toolkit -p updates.json -O -`
