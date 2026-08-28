# Response fixtures

Saved API responses for the parser specs. Each file is the body of one request,
trimmed to the shape the parser under test actually reads.

## What these do and don't catch

They catch **our** regressions: a refactor that breaks the parse, or that
quietly changes what `standardContext()` puts in front of `NameFormatter` and
so changes every downloaded filename. They do **not** catch **Pixiv's**
changes. A fixture is a frozen copy; when Pixiv renames a key, the fixture keeps
the old name and the spec keeps passing. Only a live request would notice, and
that doesn't belong in CI — it needs a session cookie and would fail on Pixiv's
schedule rather than ours.

The `missing-field` fixtures are the closest we get: they pin down what happens
when an expected key is gone, so at least the failure mode is deliberate.

## Provenance

These are hand-built to the response shapes the parsers consume, not captured
from a live account: capturing real ones means downloading someone's work while
signed in, and the ids, names and urls would then have to be scrubbed anyway.
Everything here is synthetic — the user ids, illust ids and account names belong
to nobody, and the image urls point at hosts that exist but paths that do not.

Because they are hand-built, a field the parsers ignore is generally omitted
rather than invented. If you add a fixture from a real response, scrub it first:
real user and illust ids, account names, cookies and session tokens, and any
reference to private or R-18 works.

Shapes recorded as of 2026-08-28, against Pixiv's `/ajax/*` endpoints, Fanbox's
`post.info`, and Pixiv Comic's `read_v4`.

## Layout

| Path | Endpoint |
|---|---|
| `pixiv/illust-*.json` | `/ajax/illust/{id}`, `/ajax/illust/{id}/pages`, `/ajax/illust/{id}/ugoira_meta`, `/ajax/illust/unlisted/{id}` |
| `pixiv/novel-*.json` | `/ajax/novel/{id}` |
| `fanbox/post-*.json` | `api.fanbox.cc/post.info`, as relayed by the background worker |
| `pixivComic/episode-*.json` | `comic.pixiv.net/api/app/episodes/{id}/read_v4` |
