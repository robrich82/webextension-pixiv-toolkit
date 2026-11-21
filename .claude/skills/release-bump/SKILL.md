---
name: release-bump
description: Open the chore/release-X.Y.Z PR that a release needs first, which bumps package.json's version and adds the release's user-facing entries to every HISTORY file. User-invoked only. Takes an optional version, e.g. /release-bump 6.5.0.
disable-model-invocation: true
---

# Release bump

A release starts with a `chore/release-X.Y.Z` PR that sets `package.json` `version` and adds the release's entries to the Change History page. Once it merges, `/release-firefox` cuts the release. The build stamps the version into the manifest (`scripts/manifest.mjs`), so `package.json` is the only place it changes.

## 1. Find what's being released

```bash
git fetch origin --tags
gh release list --repo robrich82/webextension-pixiv-toolkit --limit 1   # tag is the bare version, e.g. 6.4.6
git log <latest-tag>..origin/main --first-parent --oneline
```

If nothing merged since the latest tag, stop.

For each merged PR, read its title and, where the title doesn't say what a user would notice, its description (`gh pr view <n> --json title,body`). Keep only changes a user would notice: fixes, new or changed features, new settings, visible UI changes, and removed features. Skip tests, CI, docs, refactors, toolchain and dependency updates unless they change what users see. Group several PRs that fix the same thing into one entry.

## 2. Pick the version

- It must be above the latest release.
- It must be at least the highest key in `src/background/updates/index.js`, or that migration never runs for users who already have the latest release. If a key is above the version you'd otherwise pick, use the key, unless that forces a bigger bump than the changes call for: then stop and ask the user about that migration.
- Suggest a patch bump for fixes only, and a minor bump when something new or user-visible changed. If an argument was given, check it against both rules instead.

Show the user the version and the draft entries (in English), and get their go-ahead before writing anything.

## 3. Write the bump

Create the worktree per the global rules, off a freshly fetched `origin/main`, on branch `chore/release-X.Y.Z`, then `pnpm install --frozen-lockfile`.

- `package.json`: set `version` only.
- Each locale in `src/statics/histories.json` has a `src/statics/HISTORY_<locale>`. Add a block at the **top** of every one, followed by a blank line before the previous release:
  - the first line is `vX.Y.Z`;
  - one entry per line, worded as the existing entries are: "Fixed …", "… now …", "Removed …";
  - English entries end in `;`, except the last, which ends in `.`;
  - `HISTORY_zh-CN` uses `；` and a final `。`. Write it to read naturally in Chinese, following the terms the older zh-CN entries already use, rather than translating word for word.
  - Keep the file's existing line endings.

## 4. Check it

```bash
pnpm exec vitest run --coverage.enabled=false test/components/ChangeLog.spec.js test/updates.spec.js
pnpm test
```

`ChangeLog.spec` fails while any HISTORY file doesn't start with `v<package.json version>`.

## 5. Open the PR

- Commit as `chore: release X.Y.Z`.
- The diff is a version and release notes, which is data. Read the diff yourself, then push with `SKIP_MR_REVIEW=1 git push -u origin chore/release-X.Y.Z` and say so in the report.
- `gh pr create --base main --title "chore: release X.Y.Z"`. The body says in one line what the release ships, and links the PRs it collects.

Tell the user that `/release-firefox` cuts the release once the PR has merged.
