/* ---------------------------------------------------------------------------
   THE worker. One route, one flow (Bot v0 spec §3):

     POST /api/ask
       → origin check
       → rate limit (KV)
       → Mistral (index in the cached system prompt)
       → validate ids against the index, gate on intent
       → links, rebuilt from the index

   No D1, no vector store, no second service. At this index size there is
   nothing to shard and nothing to retrieve.
   --------------------------------------------------------------------------- */

import indexFile from '../../src/index.json';
import curation from '../../src/curation.json';
import { buildSystemPrompt } from '../../src/prompt.js';
import { loadIndex, resolveModelOutput } from '../../src/router.js';
import { META_KEY, gridKey } from '../../src/scan/scan.js';
import { parseSheet, applyOverride, DEFAULT_CSV_URL, CACHE_TTL_SECONDS } from '../../src/sheet.js';

/* Built once per isolate. buildSystemPrompt() depends only on the index file,
   so this string is identical on every request — which is the whole point: the
   provider's prefix cache keeps hitting and we pay for the index once. */
const BUNDLED = {
  source: 'bundled',
  version: 'bundled',
  index: loadIndex(indexFile),
  prompt: buildSystemPrompt(loadIndex(indexFile)),
};

/* The scan-layer grid, once it exists, is the index (§14.13). Cached per
   isolate and keyed on the scan timestamp, so the system prompt stays
   BYTE-IDENTICAL between scans and the provider's prefix cache keeps hitting —
   it changes exactly when the grid changes, once a week, and not per request.

   No YouTube call happens here or anywhere near here. The grid is already
   written; this only reads it. */
let cachedGrid = null;

const OVERRIDE_KEY = 'override:sheet';
const SHEET_TIMEOUT_MS = 8000;
let refreshing = false; // per-isolate guard, so one stale window fetches once

/**
 * The Sheet override (Sheet Override Brief §0), read from KV — never from
 * Google on the user's clock.
 *
 * A stale copy is served AS IS and the refresh happens after the response via
 * waitUntil. The worst case is an answer built from data a few minutes old;
 * the case we refuse is a person waiting on docs.google.com before the bot
 * says anything.
 *
 * If the fetch fails, the last good copy stays. If there has never been one,
 * the scan grid serves the whole index, exactly as it does today: the Sheet is
 * an override, not a dependency (§2 of the brief).
 */
async function fetchSheet(env) {
  const url = env.SHEET_CSV_URL || DEFAULT_CSV_URL;
  const response = await fetch(url, {
    headers: { accept: 'text/csv' },
    signal: AbortSignal.timeout(SHEET_TIMEOUT_MS),
    cf: { cacheTtl: 60 },
  });
  if (!response.ok) throw new Error(`sheet ${response.status}`);

  const text = await response.text();
  // A login page is HTML and would parse into nonsense rows rather than fail,
  // so it is caught by shape before it is parsed by content.
  if (/^\s*</.test(text)) throw new Error('sheet returned HTML, not CSV');

  const parsed = parseSheet(text, { knownTopics: new Set(curation.topics.map((t) => t.id)) });
  return {
    fetchedAt: Date.now(),
    version: parsed.version,
    rows: parsed.rows,
    notes: parsed.notes,
    byTopic: Object.fromEntries(parsed.byTopic),
  };
}

async function refreshSheet(env) {
  if (refreshing) return null;
  refreshing = true;
  try {
    const fresh = await fetchSheet(env);
    await env.GRID.put(OVERRIDE_KEY, JSON.stringify(fresh));
    return fresh;
  } catch (error) {
    console.warn('sheet refresh failed, keeping what we have:', error);
    return null;
  } finally {
    refreshing = false;
  }
}

async function getOverride(env, ctx) {
  if (!env.GRID) return null;

  let stored = null;
  try {
    stored = await env.GRID.get(OVERRIDE_KEY, 'json');
  } catch (error) {
    console.warn('override unreadable:', error);
  }

  const age = stored ? (Date.now() - stored.fetchedAt) / 1000 : Infinity;
  if (stored && age < CACHE_TTL_SECONDS) return stored;

  // Stale: answer from what we have and refresh behind the response. Nothing
  // to answer from at all (first ever request): pay for one fetch, once.
  if (stored) {
    ctx?.waitUntil?.(refreshSheet(env));
    return stored;
  }
  return refreshSheet(env);
}

async function getIndex(env, ctx) {
  if (!env.GRID) return BUNDLED;

  let meta;
  try {
    meta = await env.GRID.get(META_KEY, 'json');
  } catch (error) {
    console.warn('grid meta unreadable, serving the bundled index:', error);
    return BUNDLED;
  }
  if (!meta?.topics?.length) return BUNDLED; // scan has never run

  // Two cheap reads decide whether anything has to be rebuilt: when the scan
  // ran, and which version of the sheet we hold. The thirty-odd box reads below
  // only happen when one of them has actually moved.
  const override = await getOverride(env, ctx);
  const version = `${meta.lastScan}|${override?.version ?? 'none'}`;
  if (cachedGrid?.version === version) return cachedGrid;

  const videos = [];
  for (const topic of meta.topics) {
    for (const register of ['start', 'deep']) {
      const box = await env.GRID.get(gridKey(topic, register), 'json');
      for (const entry of box ?? []) videos.push({ ...entry, register });
    }
  }
  if (!videos.length && !override?.rows) return BUNDLED;

  // The Sheet owns the topics it lists; the grid keeps every other one (§0 of
  // the override brief). One owner per topic, never a mix.
  const parsedOverride = override?.byTopic
    ? { byTopic: new Map(Object.entries(override.byTopic)) }
    : null;
  const { videos: merged, overriddenTopics } = applyOverride({ gridVideos: videos, override: parsedOverride });

  // Aliases live in curation.json, not in the grid or the sheet: those hold
  // what we serve, aliases hold what a person might type.
  const index = loadIndex({ status: 'CURATED', topics: curation.topics, videos: merged });
  cachedGrid = {
    source: overriddenTopics.length ? 'kv+sheet' : 'kv',
    version,
    index,
    prompt: buildSystemPrompt(index),
    overriddenTopics,
    sheetNotes: override?.notes ?? [],
  };
  return cachedGrid;
}

const MODEL = 'mistral-small-latest';
const MODEL_TIMEOUT_MS = 20_000;

/* Safety, not monetisation (§9 CB) — sized so a person never meets it and a
   script does. */
const LIMITS = [
  { window: 'm', seconds: 60, max: 8 },
  { window: 'h', seconds: 3600, max: 60 },
];

/* Who may call this endpoint.
   askcarnivores.com is deliberately ABSENT. The portal reaches the bot through
   an iframe of our public /embed page — a window, not a client (§16). The day
   the portal's component fetches this worker directly, the two repos are
   coupled. The allow-list is where that stays impossible. */
const ALLOWED_HOSTS = new Set([
  'askcarnivore.com',
  'www.askcarnivore.com',
  'localhost',
  '127.0.0.1',
]);

const MAX_TURNS = 10;
const MAX_CHARS_PER_TURN = 1000;
const MAX_CHARS_TOTAL = 4000;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });

function originAllowed(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // same-origin navigations and curl
  try {
    const { hostname } = new URL(origin);
    return ALLOWED_HOSTS.has(hostname) || hostname.endsWith('.pages.dev');
  } catch {
    return false;
  }
}

/** Hash the IP before it becomes a key. We rate-limit an address without
    storing one. */
async function clientKey(request) {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Fixed-window counters in KV. Two concurrent requests can each read the same
 * value and both write n+1 — that undercounts by a request or two under load,
 * which is the right trade here: this is a brake, not a meter.
 */
async function checkRateLimit(env, request) {
  if (!env.RATE_LIMIT) {
    // Preview deploys before the namespace exists. Loud, not silent.
    console.warn('RATE_LIMIT KV binding missing — rate limiting is OFF');
    return { ok: true, enforced: false };
  }
  const key = await clientKey(request);
  for (const { window, seconds, max } of LIMITS) {
    const name = `rl:${window}:${key}`;
    const used = Number(await env.RATE_LIMIT.get(name)) || 0;
    if (used >= max) return { ok: false, enforced: true, retryAfter: seconds };
    await env.RATE_LIMIT.put(name, String(used + 1), { expirationTtl: seconds });
  }
  return { ok: true, enforced: true };
}

/**
 * Client turns → provider turns.
 * Assistant turns are replayed with the ids they served appended, so "give me
 * more" has something concrete to avoid repeating. That list IS the session
 * state (§14.7) — we keep none of our own.
 */
function toProviderMessages(messages, index) {
  const turns = [];
  for (const message of messages.slice(-MAX_TURNS)) {
    const role = message?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(message?.content ?? '').slice(0, MAX_CHARS_PER_TURN).trim();
    if (!content) continue;
    const shown = Array.isArray(message?.shown)
      ? message.shown.filter((id) => typeof id === 'string' && index.byId.has(id))
      : [];
    turns.push({
      role,
      content:
        role === 'assistant' && shown.length
          ? `${content}\n[already shown: ${shown.join(', ')}]`
          : content,
    });
  }
  return turns;
}

async function askModel(env, turns, systemPrompt) {
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.MISTRAL_MODEL || MODEL,
      temperature: 0.2,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: systemPrompt }, ...turns],
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`provider ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content ?? '';
  return JSON.parse(content); // throws on garbage — handled by the caller
}

/**
 * ?debug=1 plus the scan token. The flag alone is not a gate — anyone can type
 * it — so the same bearer that guards /api/scan guards this. Without the token
 * the parameter is simply ignored, with no hint that it means anything, and the
 * answer a visitor gets is byte-identical either way.
 *
 * Compared the same constant-time-ish way as in scan.js rather than imported,
 * because the two endpoints should stay independently readable; this is four
 * lines, not a shared module.
 */
function debugRequested(request, env) {
  if (new URL(request.url).searchParams.get('debug') !== '1') return false;
  const provided = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const expected = env.SCAN_TOKEN;
  if (!provided || !expected || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!originAllowed(request)) return json({ error: 'forbidden_origin' }, 403);
  if (!env.MISTRAL_API_KEY) return json({ error: 'not_configured' }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const total = messages.reduce((sum, m) => sum + String(m?.content ?? '').length, 0);
  if (!messages.length || total > MAX_CHARS_TOTAL) {
    return json({ error: 'bad_request' }, 400);
  }

  const limit = await checkRateLimit(env, request);
  if (!limit.ok) {
    return json({ error: 'rate_limited' }, 429, { 'retry-after': String(limit.retryAfter) });
  }

  // The grid if the scan has filled it, the bundled index if it has not. Read
  // after the rate limit so a flood cannot turn into KV reads.
  const active = await getIndex(env, context);

  let raw;
  try {
    raw = await askModel(env, toProviderMessages(messages, active.index), active.prompt);
  } catch (error) {
    console.error('model call failed:', error);
    return json({ error: 'upstream_unavailable' }, 502);
  }

  const result = resolveModelOutput({ raw, index: active.index });

  return json({
    intent: result.intent,
    topic: result.topic,
    lang: result.answerLang,
    copy: result.copy,
    links: result.links,
    // Present only when the deep view is a different answer from the one above
    // it (src/router.js). Its absence IS the instruction to the client: no
    // field, no button — so the landing page and the framed /embed cannot end
    // up offering different things.
    ...(result.deepLinks?.length ? { deep_links: result.deepLinks } : {}),
    fallback: result.fallback,
    meta: {
      // The client turns this into the banner that stops placeholder content
      // being mistaken for a real source.
      index_status: active.index.status,
      index_source: active.source,
      override_topics: active.overriddenTopics ?? [],
      rate_limit: limit.enforced ? 'on' : 'off',
      // The two note lists are diagnostics, not an answer: which sheet rows were
      // refused and why, which ids the model asked for and did not get. Useful
      // to us, meaningless to a visitor, and a free readout of our internals to
      // anyone else — so they ship only when asked for AND authenticated.
      ...(debugRequested(request, env) ? { notes: result.notes, sheet_notes: active.sheetNotes ?? [] } : {}),
    },
  });
}

export function onRequest() {
  return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
}
