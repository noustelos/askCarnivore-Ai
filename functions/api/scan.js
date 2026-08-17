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
import { runScan, pruneDeadLinks, gridKey, stateKey, META_KEY } from '../../src/scan/scan.js';

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

  const client = createClient(env.YOUTUBE_API_KEY);
  let result;
  try {
    result = await runScan({ curation, client, state, now: Date.now(), only });
    await pruneDeadLinks({ grid: result.grid, client });
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
  await env.GRID.put(META_KEY, JSON.stringify(result.meta));

  return json({ ok: true, meta: result.meta, written: result.grid.size + result.state.size + 1 });
}

export function onRequest() {
  return json({ error: 'method_not_allowed' }, 405);
}

export { gridKey };
