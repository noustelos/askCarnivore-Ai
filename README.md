# askCarnivore AI

A switchboard for the carnivore community: ask a question, get sent to the
videos that cover it. → [askcarnivore.com](https://askcarnivore.com)

The bot **routes**. It does not explain physiology, it does not give medical
advice, and it does not sell anything. Concept, decisions and open items live in
[CLAUDE.md](CLAUDE.md).

## Layout

```
index.html      landing page + the ask box
embed.html      /embed — the view askcarnivores.com frames (§16)
chat.css        the chat surface, shared by both pages
chat.js         the chat client, shared by both pages
_headers        CSP, incl. who may frame us
functions/
  api/ask.js    THE worker: one route, one flow
src/
  index.json    the curated index — topic → creator → register → video
  prompt.js     the system prompt (index in, no URLs)
  router.js     validation and gating of whatever the model returns
test/
  router.test.mjs
```

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
node --test test/router.test.mjs   # the rules above, no dependencies
python3 -m http.server 8000        # static pages only (the worker will 404)
npx wrangler pages dev .           # the real thing — needs macOS 13.5+ for workerd
```

For a live worker you need `MISTRAL_API_KEY` in `.dev.vars` and a `RATE_LIMIT`
KV binding. Without the key the endpoint answers `503 not_configured`; without
the KV binding it runs with rate limiting **off** and says so in `meta`.

## Deploy

Cloudflare Pages, connected to this repo. No build command, output directory
`/`; the `functions/` folder is picked up automatically. Separate project,
separate secrets, separate analytics from `askcarnivores.com` — always.
