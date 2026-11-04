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
6. **VPN.** Ask whether ProtonVPN is on. It makes the TLS resets against addons.mozilla.org worse, and a reset after AMO has the version stops the script (see below). Offer to wait while it's turned off.

Summarise the results of all six checks and get an explicit go-ahead before going further.

## Release

```bash
pnpm run release:firefox
```

Run it in the background (`run_in_background`). The script sets no timeout, and AMO approval can take longer than the Bash tool's 10-minute foreground limit.

**If it fails, read the end of its output before rerunning.**
- The script retries a failed sign only while AMO has no record of the version. Once AMO has it, or the script can't tell, it stops and says so. web-ext creates the version before approval and download, and AMO won't accept it again.
- In that case, download the signed `.xpi` from the AMO developer hub once it's approved, save it as `web-ext-artifacts/pixiv-toolkit-firefox-<version>.xpi`, and rerun.
- A rerun that finds that file skips build and sign and publishes it. This also covers a failure after `Signed:` was printed. Don't delete `web-ext-artifacts/` in that case.
- If `gh release create` failed partway, check whether the release exists before rerunning (`gh release view <version>`). If it does, ask the user whether to delete it and rerun, or finish it by hand.

## Afterwards

- Report the release URL from the script's output and the `.xpi`'s sha256.
- Confirm that `updates.json` on the new release lists the new version:
  `gh release download <version> --repo robrich82/webextension-pixiv-toolkit -p updates.json -O -`
