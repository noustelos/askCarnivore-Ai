/* ---------------------------------------------------------------------------
   Router logic — the half of the bot that does not trust the model.

   The model matches; this file verifies. Everything here is pure (no fetch, no
   env, no platform), so it can be exercised directly by test/router.test.mjs.

   Two properties are structural, not prompt-dependent (Bot v0 spec §4). If a
   later refactor moves them, it has broken the bot, not tidied it:

     1. The model never emits a URL. It returns ids; links are rebuilt here from
        the index. It cannot cite a video that does not exist, because it never
        saw a URL to copy or invent. Any URL that does appear in its prose is
        stripped on the way out.
     2. intent === "personal-medical" returns ZERO links, no matter what the
        model asked for. The redirect-to-a-doctor rule does not rest on the
        model obeying it.
   --------------------------------------------------------------------------- */

/** 3–4 links, per spec §1. The ceiling is on what we render, not what we ask. */
export const MAX_LINKS = 4;

export const INTENTS = [
  'conceptual',
  'testimonial',
  'quick-practical',
  'personal-medical',
  'off-topic',
];

/** Where honest-unmatched sends people. A public hyperlink is the only link
    between the two sites (§16) — the portal's directory, not our own content. */
export const DIRECTORY = {
  url: 'https://askcarnivores.com',
  label: {
    en: 'Browse the directory of doctors and creators',
    el: 'Δες τον κατάλογο γιατρών & creators',
  },
};

const MAX_COPY_CHARS = 1200;
const MAX_LABEL_CHARS = 160;

/* The model is told not to write URLs; this is what happens when it does
   anyway. Three passes, because "go and search youtube.com" is the same failure
   as a pasted link — a route we did not curate, dressed as one we did. */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()[\]"']+/gi;
const MD_LINK_RE = /\[([^\]]*)\]\((?:[^)]*)\)/g;
const BARE_DOMAIN_RE =
  /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|gr|co|tv|me|ai|app|dev)\b(?:\/\S*)?/gi;

/**
 * Index file → the shape the worker and the prompt both read.
 * Aliases are union'd per topic so that four entries of one topic listing
 * slightly different aliases cannot drift into four different topics.
 */
export function loadIndex(raw) {
  const entries = Array.isArray(raw?.entries) ? raw.entries : [];
  const byId = new Map();
  const topics = new Map();

  for (const entry of entries) {
    if (!entry?.id || !entry?.url || !entry?.topic) continue;
    if (byId.has(entry.id)) continue; // first wins; a duplicate id is a curation bug
    byId.set(entry.id, entry);

    const aliases = topics.get(entry.topic) ?? new Set([entry.topic]);
    for (const alias of entry.topic_aliases ?? []) aliases.add(String(alias));
    topics.set(entry.topic, aliases);
  }

  return {
    status: raw?.status === 'CURATED' ? 'CURATED' : 'PLACEHOLDER',
    schemaVersion: raw?.schema_version ?? 0,
    entries: [...byId.values()],
    byId,
    topics: new Map([...topics].map(([topic, set]) => [topic, [...set]])),
  };
}

/** Strip anything that looks like a link out of model prose. */
export function stripUrls(text) {
  return String(text ?? '')
    .replace(MD_LINK_RE, '$1')
    .replace(URL_RE, '')
    .replace(BARE_DOMAIN_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.·;:!?])/g, '$1')
    .trim();
}

function clean(text, max) {
  const stripped = stripUrls(text);
  return stripped.length > max ? `${stripped.slice(0, max - 1).trimEnd()}…` : stripped;
}

function normalizeLang(value) {
  return value === 'el' ? 'el' : 'en';
}

/**
 * Take the model's raw JSON, return what the client is allowed to see.
 *
 * Note there is no session machinery here on purpose (spec §4): "give me more"
 * is answered by the conversation history in the prompt, which carries the ids
 * already served, not by state we keep.
 *
 * @param {object} args.raw    parsed model output (untrusted)
 * @param {object} args.index  output of loadIndex()
 */
export function resolveModelOutput({ raw, index }) {
  const notes = [];

  let intent = INTENTS.includes(raw?.intent) ? raw.intent : null;
  if (!intent) {
    // An unclassifiable turn is treated as conceptual, never as practical
    // advice — and every link it carries still has to survive validation.
    notes.push(`unknown-intent:${JSON.stringify(raw?.intent ?? null)}`);
    intent = 'conceptual';
  }

  const answerLang = normalizeLang(raw?.answer_lang);
  const copy = clean(raw?.copy, MAX_COPY_CHARS);

  // ---- gate 1: personal-medical never carries links -----------------------
  if (intent === 'personal-medical') {
    if (Array.isArray(raw?.video_ids) && raw.video_ids.length) {
      notes.push(`medical-gate-dropped:${raw.video_ids.length}`);
    }
    return {
      intent,
      topic: null,
      answerLang,
      copy,
      links: [],
      fallback: null, // a doctor is the answer here; not the directory
      notes,
    };
  }

  // ---- gate 2: ids must exist in the index --------------------------------
  const requested = Array.isArray(raw?.video_ids) ? raw.video_ids : [];
  const labels = raw?.labels && typeof raw.labels === 'object' ? raw.labels : {};
  const seen = new Set();
  const links = [];

  for (const id of requested) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);

    const entry = index.byId.get(id);
    if (!entry) {
      notes.push(`unknown-id:${id}`);
      continue;
    }
    if (links.length >= MAX_LINKS) {
      notes.push(`over-cap:${id}`);
      continue;
    }

    const entryLang = normalizeLang(entry.lang);
    links.push({
      id: entry.id,
      // Rebuilt from the index — never from the model.
      url: entry.url,
      title: entry.title,
      creator: entry.creator,
      register: entry.register ?? 'pending',
      type: entry.type ?? 'conceptual',
      lang: entryLang,
      // Cross-language is surfaced, never hidden and never a reason to drop a
      // link: if the only source for a Greek question is in English, we serve
      // it and say so.
      crossLang: entryLang !== answerLang,
      label: clean(entry.label ?? labels[id] ?? '', MAX_LABEL_CHARS) || null,
      curatedLabel: Boolean(entry.label),
    });
  }

  const topic = index.topics.has(raw?.topic) ? raw.topic : null;

  return {
    intent,
    topic,
    answerLang,
    copy,
    links,
    // Honest unmatched: no invented source, one real place to go next.
    fallback: links.length
      ? null
      : { url: DIRECTORY.url, label: DIRECTORY.label[answerLang] },
    notes,
  };
}
