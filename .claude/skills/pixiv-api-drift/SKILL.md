---
name: pixiv-api-drift
description: Check whether Pixiv, Fanbox or Pixiv Comic changed the API responses the parsers read, by comparing live response shapes from the user's signed-in Chrome with test/fixtures. User-invoked only.
disable-model-invocation: true
---

# Pixiv API drift

The fixtures in `test/fixtures` are frozen copies of what each site's API returned, so a rename on Pixiv's side never fails a spec (`test/fixtures/README.md`). This check requests the live APIs through Claude in Chrome, where the user is signed in, and compares only the **shape** of each response (key paths and types) with the fixture. `scripts/apiShape.mjs` does both halves. Its browser snippet reduces the response to a shape inside the page, with id-like keys folded to `*`, so no titles, names, ids or URLs leave the browser.

## 1. Get the works to check

Ask the user for one of each, or tell them they can skip any:

| Kind | URL to request | Page to run it on | Compare with |
|---|---|---|---|
| Illustration | `https://www.pixiv.net/ajax/illust/{id}` and `…/{id}/pages` | `https://www.pixiv.net/` | `pixiv/illust-single.json`, `pixiv/illust-single-pages.json` |
| Manga (several pages) | `https://www.pixiv.net/ajax/illust/{id}` and `…/{id}/pages` | `https://www.pixiv.net/` | `pixiv/illust-manga.json`, `pixiv/illust-manga-pages.json` |
| Ugoira | `https://www.pixiv.net/ajax/illust/{id}` and `…/{id}/ugoira_meta` | `https://www.pixiv.net/` | `pixiv/illust-ugoira.json`, `pixiv/illust-ugoira-meta.json` |
| Novel | `https://www.pixiv.net/ajax/novel/{id}` | `https://www.pixiv.net/` | `pixiv/novel-single.json`, or `pixiv/novel-series.json` for a novel in a series |
| Fanbox article (blog-style) post the user can view, ideally with images and a file attachment | `https://api.fanbox.cc/post.info?postId={id}` | `https://www.fanbox.cc/` | `fanbox/post-article.json` |
| Pixiv Comic episode the user can read | `https://comic.pixiv.net/api/app/episodes/{id}/read_v4` | `https://comic.pixiv.net/` | `pixivComic/episode.json` |

Don't pick works yourself. The requests run as the user's account, and the user decides what it opens. Ask for all-ages works.

## 2. Request each one

Read the `anthropic-skills:chrome-browser` skill first, then open one new tab. For each row the user gave:

1. Navigate the tab to the row's page, so the request comes from the API's own site, with its cookies and CORS.
2. `node scripts/apiShape.mjs snippet <url>` prints an expression that resolves to a JSON string. Evaluate it in the tab with the browser's JavaScript tool. If the tool hands back a Promise instead of its value, evaluate `await (<snippet>)`.
3. Save the string to a file in the scratchpad, for example `<scratchpad>/api-drift/illust.json`.
4. `node scripts/apiShape.mjs compare test/fixtures/<fixture> <file>`. Exit 2 means it couldn't compare (a bad file or URL), not drift.

Close the tab when done.

## 3. Read the results

`compare` prints one line per fixture path and exits 1 when something drifted:

- `missing`: the live response doesn't have a path that the fixture has.
- `type`: the live response never has the fixture's type at that path, for example a number where the fixture has a string, or `null`.
- `unverified`: the live response can't show it, because an array or id map was empty or a parent was null. This is not drift.
- `request failed: HTTP <status>`: usually not signed in, or a work the account can't open.

Not every finding is drift. The fixtures carry some fields only certain works have. Before reporting a path, grep the parser for its key (`src/modules/Parser/Pixiv/IllustParser.js`, `NovelParser.js`, `Fanbox/PostParser.js`, `PixivComic/EpisodeParser.js`). A key no parser reads isn't drift that matters, and one the parser treats as optional isn't either. These are expected:

- `seriesNavData` is `null` on a work outside a series, so a manga outside one (compared with `illust-manga.json`) or a novel compared with `novel-series.json` shows a `type` finding with `unverified` lines under it.
- Fanbox's `coverImageUrl` is often `null`; the parser falls back to the first image.
- Fanbox's `blocks[]` mixes block kinds, so a post without a file, image or text block reports `blocks[].fileId`, `.imageId` or `.text` missing. No parser reads `fileMap` or `fileId`.
- `type $.body.post.body` with `null` live means the account can't view the post (`isRestricted`). Ask for another one.
- If the only finding is `missing $.body.post`, Fanbox returned the older un-nested shape, which `PostParser` also reads (`response.body.post || response.body`). Report that as a shape change rather than a break.

## 4. Report

Give a table: each endpoint, its fixture, and either "no drift" or its findings. For each finding, say whether the parser reads that key and what would break.

For real drift, offer to file a fork issue (`robrich82/webextension-pixiv-toolkit`) that names the endpoint, the paths and the parser lines. Leave out work ids and response values. Fixing the parser and updating the fixture is a separate change. Fixtures stay hand-built and synthetic (see the fixtures README), so never paste a live response into one.
