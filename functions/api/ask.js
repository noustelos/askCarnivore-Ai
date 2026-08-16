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
import { buildSystemPrompt } from '../../src/prompt.js';
import { loadIndex, resolveModelOutput } from '../../src/router.js';

/* Built once per isolate. buildSystemPrompt() depends only on the index file,
   so this string is identical on every request — which is the whole point: the
   provider's prefix cache keeps hitting and we pay for the index once. */
const INDEX = loadIndex(indexFile);
const SYSTEM_PROMPT = buildSystemPrompt(INDEX);

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
function toProviderMessages(messages) {
  const turns = [];
  for (const message of messages.slice(-MAX_TURNS)) {
    const role = message?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(message?.content ?? '').slice(0, MAX_CHARS_PER_TURN).trim();
    if (!content) continue;
    const shown = Array.isArray(message?.shown)
      ? message.shown.filter((id) => typeof id === 'string' && INDEX.byId.has(id))
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

async function askModel(env, turns) {
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
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...turns],
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

  let raw;
  try {
    raw = await askModel(env, toProviderMessages(messages));
  } catch (error) {
    console.error('model call failed:', error);
    return json({ error: 'upstream_unavailable' }, 502);
  }

  const result = resolveModelOutput({ raw, index: INDEX });

  return json({
    intent: result.intent,
    topic: result.topic,
    lang: result.answerLang,
    copy: result.copy,
    links: result.links,
    fallback: result.fallback,
    meta: {
      // The client turns this into the banner that stops placeholder content
      // being mistaken for a real source.
      index_status: INDEX.status,
      rate_limit: limit.enforced ? 'on' : 'off',
      // Kept for the preview review; drop or keep behind a flag once live.
      notes: result.notes,
    },
  });
}

export function onRequest() {
  return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
}
