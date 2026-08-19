/* ---------------------------------------------------------------------------
   POST /api/scan — runs the scan and writes the grid to KV.

   ⚠ WHY THIS IS AN ENDPOINT AND NOT A `scheduled()` HANDLER
   The build brief says "Cloudflare Cron Trigger → scheduled worker". Cron
   Triggers are a **Workers** feature: they pair a cron expression with a
   `scheduled()` handler declared in a Worker's Wrangler config. This project is
   **Cloudflare Pages**, whose Functions only ever run `onRequest*` — there is
   no scheduled handler to attach a cron to, and Pages' Wrangler configuration
   has no `triggers` block. (Same shape of limit as "you cannot create a
   Durable Object inside a Pages project".)

   So the scan is a protected endpoint, and the *schedule* is external. That
   keeps every option open — a GitHub Actions cron, or a five-line Worker with
   a cron trigger that does nothing but fetch this URL — without adding a
   second deploy target to a repo that deliberately has no build step.

   Guarded by a bearer token, because an unauthenticated scan endpoint is a
   free way for a stranger to burn our YouTube quota.

   The user request path is untouched by all of this: /api/ask never calls
   YouTube, before or after (§14.13).
   --------------------------------------------------------------------------- */

import curation from '../../src/curation.json';
import { createClient, QuotaError } from '../../src/scan/youtube.js';
import { runScan, pruneDeadLinks, gridKey, stateKey, videosKey, META_KEY } from '../../src/scan/scan.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/** Constant-time-ish compare, so a token cannot be guessed byte by byte. */
function tokenMatches(provided, expected) {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const provided = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!env.SCAN_TOKEN || !tokenMatches(provided, env.SCAN_TOKEN)) {
    return json({ error: 'forbidden' }, 403);
  }
  if (!env.YOUTUBE_API_KEY) return json({ error: 'not_configured', missing: 'YOUTUBE_API_KEY' }, 503);
  if (!env.GRID) return json({ error: 'not_configured', missing: 'GRID kv binding' }, 503);

  const url = new URL(request.url);

  // ?inspect=topic:register — read one box back out of KV and return it with the
  // numbers that decided the order. One KV read, no scanning, so it stays well
  // inside the Free plan's 10ms of CPU. This exists because "why is this box
  // three-quarters one creator" is a question that should be answerable with
  // data rather than by re-deriving the ranking in your head.
  // ?reset=1 with ?only= — forget a creator's watermark and stored videos, so
  // the next scan re-reads them from scratch. Needed when a RULE changes (the
  // duration floor did) rather than the data: the incremental watermark would
  // otherwise happily skip everything and leave the old decisions in place.
  // Deletes only; no scanning, so it costs almost no CPU.
  if (url.searchParams.get('reset') === '1') {
    if (!env.GRID) return json({ error: 'not_configured', missing: 'GRID kv binding' }, 503);
    const ids = url.searchParams.get('only')?.split(',').filter(Boolean) ?? [];
    if (!ids.length) return json({ error: 'reset_needs_only' }, 400);
    for (const id of ids) {
      await env.GRID.delete(stateKey(id));
      await env.GRID.delete(videosKey(id));
    }
    return json({ ok: true, reset: ids });
  }

  const inspect = url.searchParams.get('inspect');
  if (inspect) {
    if (!env.GRID) return json({ error: 'not_configured', missing: 'GRID kv binding' }, 503);
    const [topic, register = 'start'] = inspect.split(':');
    const box = (await env.GRID.get(gridKey(topic, register), 'json')) ?? [];
    return json({
      key: gridKey(topic, register),
      size: box.length,
      entries: box.map((e, i) => ({
        rank: i + 1,
        creator: e.creator,
        views: e.views,
        published_at: e.published_at,
        duration: e.duration,
        score: Math.round(e.score ?? 0),
        pinned: e.pinned ?? false,
        source: e.source,
        title: e.title,
      })),
    });
  }

  // Batching: a full 28-channel pass can outlive a single invocation, so the
  // caller can walk the roster in slices and the state in KV makes each slice
  // resumable. No argument = everybody.
  const only = url.searchParams.get('only')?.split(',').filter(Boolean) ?? null;
  const dryRun = url.searchParams.get('dry') === '1';

  // Resolved ids live in curation.json; the scan never re-resolves them.
  if (curation.creators.some((creator) => !creator.channel_id)) {
    return json({ error: 'unresolved_channels', hint: 'run tools/resolve-channels.mjs first' }, 409);
  }

  const state = new Map();
  for (const creator of curation.creators) {
    const raw = await env.GRID.get(stateKey(creator.id), 'json');
    if (raw) state.set(creator.id, raw);
  }
  for (const host of curation.trusted_hosts ?? []) {
    const raw = await env.GRID.get(stateKey(`host:${host.handle}`), 'json');
    if (raw) state.set(`host:${host.handle}`, raw);
  }

  // Everything already known, for EVERY creator — not just this batch. The grid
  // is rebuilt from the union each run, so a narrow batch adds to the picture
  // instead of replacing it.
  const existing = new Map();
  for (const creator of curation.creators) {
    const stored = await env.GRID.get(videosKey(creator.id), 'json');
    if (stored?.length) existing.set(creator.id, stored);
  }

  const client = createClient(env.YOUTUBE_API_KEY);
  let result;
  try {
    result = await runScan({ curation, client, state, existing, now: Date.now(), only });
    // Link rot only needs asking about entries this run did not just fetch —
    // videos.list already dropped anything non-public. Skipped on a dry run,
    // where every extra call eats the Free plan's 50-subrequest ceiling.
    if (!dryRun) await pruneDeadLinks({ grid: result.grid, client });
  } catch (error) {
    if (error instanceof QuotaError) {
      // Stop, keep whatever is already in KV, and say so. A half-written grid
      // is worse than yesterday's complete one.
      return json({ error: 'quota_exceeded', units: client.unitsUsed }, 429);
    }
    console.error('scan failed:', error);
    return json({ error: 'scan_failed', detail: String(error).slice(0, 300) }, 502);
  }

  if (dryRun) {
    return json({ dry_run: true, meta: result.meta, keys: [...result.grid.keys()] });
  }

  for (const [key, entries] of result.grid) await env.GRID.put(key, JSON.stringify(entries));
  for (const [id, value] of result.state) await env.GRID.put(stateKey(id), JSON.stringify(value));
  for (const [id, entries] of result.entriesByCreator) {
    await env.GRID.put(videosKey(id), JSON.stringify(entries));
  }
  await env.GRID.put(META_KEY, JSON.stringify(result.meta));

  return json({ ok: true, meta: result.meta, written: result.grid.size + result.state.size + 1 });
}

export function onRequest() {
  return json({ error: 'method_not_allowed' }, 405);
}

export { gridKey };
