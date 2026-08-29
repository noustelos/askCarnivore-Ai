# askCarnivore AI

A switchboard for the carnivore community: ask a question, get sent to the
videos that cover it. → [askcarnivore.com](https://askcarnivore.com)

Its sibling is [askcarnivores.com](https://askcarnivores.com) — plural, static,
the human directory. Separate repo, separate Pages project, separate secrets.

The bot **routes**. It does not explain physiology, it does not give medical
advice, and it does not sell anything. Concept, decisions and open items live in
[CLAUDE.md](CLAUDE.md).

## Layout

```
index.html        landing page + the ask box
about.html        /about — "My Story", bilingual, its own language switch
embed.html        /embed — the view askcarnivores.com frames (§16)
chat.css          the chat surface, shared by the landing and /embed
chat.js           the chat client, shared by the landing and /embed
_headers          CSP, incl. who may frame us — declared per page
functions/api/
  ask.js          THE worker: one route, one flow
  scan.js         POST /api/scan — fills the grid, token-guarded
src/
  curation.json   HUMAN: 16 topics × 27 creators, the scanner's input
  index.json      the bundled index — fallback when KV is empty
  prompt.js       the system prompt (index in, no URLs)
  router.js       validation and gating of whatever the model returns
  sheet.js        the Sheet override — one topic, one owner
  scan/           match · rank · youtube · scan
test/
  router.test.mjs · scan.test.mjs · sheet.test.mjs
```

The index has three sources, in order: the **KV grid** written by the scanner,
the **Sheet override** on top of it, then the bundled `src/index.json` as a
fallback. Which one answered is in `meta.index_source`.

## Two rules that are not refactorable

1. **The model never emits a URL.** It is shown ids and titles, it returns ids,
   and `src/router.js` rebuilds the links from `src/index.json`. It cannot cite
   a video that does not exist.
2. **`intent: "personal-medical"` returns zero links**, in the worker, whatever
   the model asked for. The redirect to a doctor does not depend on the model
   behaving.

`test/router.test.mjs` exists to keep both true.

## Local

```bash
node --test test/router.test.mjs test/scan.test.mjs test/sheet.test.mjs
python3 -m http.server 8000        # static pages only (the worker will 404)
npx wrangler pages dev .           # the real thing — needs macOS 13.5+ for workerd
```

`node --test test/` does not work on this Node — pass the files, not the folder.

For a live worker you need `MISTRAL_API_KEY` in `.dev.vars` and a `RATE_LIMIT`
KV binding. Without the key the endpoint answers `503 not_configured`; without
the KV binding it runs with rate limiting **off** and says so in `meta`.

## Deploy

Cloudflare Pages, connected to this repo. No build command, output directory
`/`; the `functions/` folder is picked up automatically. Separate project,
separate secrets, separate analytics from `askcarnivores.com` — always.

`main` is production and a push to it is live in well under a minute, so
anything bigger than a typo gets a branch first — Cloudflare builds every branch
at `https://<branch>.askcarnivore.pages.dev` with no setup. Check that, then
merge.

**Adding a page?** `_headers` sets the CSP **per page and has no `/*` rule**, on
purpose: two matching rules are merged and the strictest wins, so a blanket
`frame-ancestors 'none'` would silently veto `/embed`. The cost is that a new
page with no rule of its own ships with **no CSP at all**. Declare both paths —
`/name` and `/name.html` — since Pages serves it under either.

## Working alongside the portal

The two repos are separate checkouts in separate folders, so which one is open
in an editor decides nothing and neither can reach the other by accident. The
siloing rule governs content and code — no imports, no shared tokens, no
cross-repo fetches — not tooling; working on both in the same session is fine.
Shared surfaces (the studio credit, the contact address, the in-development
banner) are **copied by hand** into each repo, so the real risk is forgetting to
mirror one. Change it in both, and say so in the commit message.
