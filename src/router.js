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
     3. A creator name NARROWS an answer, it never unlocks one. The filter runs
        AFTER both gates above, on links they already approved, so "should I
        stop my meds, according to Mason" is a medical question that happens to
        name someone — it returns before the name is ever looked at. Moving the
        filter earlier would make a name a way around the gate.
   --------------------------------------------------------------------------- */

import { filterByCreator } from './creator.js';

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
 *
 * Aliases are declared once, on the topic, rather than repeated on every video:
 * four entries of one topic can no longer drift into four spellings of it. This
 * is the shape the scan layer will emit, so the loader already speaks it.
 */
export function loadIndex(raw) {
  const byId = new Map();
  const aliases = new Map();

  for (const topic of Array.isArray(raw?.topics) ? raw.topics : []) {
    if (!topic?.id) continue;
    aliases.set(topic.id, new Set([topic.id, ...(topic.aliases ?? []).map(String)]));
  }

  const topics = new Map();
  for (const entry of Array.isArray(raw?.videos) ? raw.videos : []) {
    if (!entry?.id || !entry?.url || !entry?.topic) continue;
    if (byId.has(entry.id)) continue; // first wins; a duplicate id is a curation bug
    byId.set(entry.id, entry);
    // A topic exists for the bot only once a video lands in it: an empty box is
    // a promise we cannot keep, and the prompt would advertise it.
    topics.set(entry.topic, aliases.get(entry.topic) ?? new Set([entry.topic]));
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
 * Is the deep view worth offering at all?
 *
 * Register lives per video via duration (§14.4), so a topic holding one video
 * — or one creator's single video mirrored into both boxes (§14.16) — produces
 * a "deep" list that is the same list again. Offering "show me the deep dive"
 * there is a promise of more that is answered with the same three links, which
 * reads as a broken button rather than an honest edge case.
 *
 * Decided here rather than in the client, so the landing page and the framed
 * /embed cannot drift into two different answers to the same question.
 */
function keepIfDistinct(links, deepLinks) {
  if (!deepLinks.length) return [];
  const shown = new Set(links.map((link) => link.id));
  const sameSet = deepLinks.length === shown.size && deepLinks.every((link) => shown.has(link.id));
  return sameSet ? [] : deepLinks;
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
      // The gate closes on both views at once. A "show me the deep dive" button
      // that produced videos here would be the medical redirect with a way
      // around it — the rule does not have a second door.
      deepLinks: [],
      fallback: null, // a doctor is the answer here; not the directory
      // Named or not, a medical question is not a creator-scoped one. Saying
      // "no videos from Mason" here would be answering the question sideways.
      creatorScope: null,
      notes,
    };
  }

  // ---- gate 2: ids must exist in the index --------------------------------
  // Both views go through this, called twice. One resolver, so "deep" can never
  // become a second, laxer path into the same output: whatever is true of the
  // list a person sees first is true of the one behind the button.
  const labels = raw?.labels && typeof raw.labels === 'object' ? raw.labels : {};
  const resolve = (requested, tag) => {
    const seen = new Set();
    const links = [];

    for (const id of Array.isArray(requested) ? requested : []) {
      if (typeof id !== 'string' || seen.has(id)) continue;
      seen.add(id);

      const entry = index.byId.get(id);
      if (!entry) {
        notes.push(`unknown-id${tag}:${id}`);
        continue;
      }
      if (links.length >= MAX_LINKS) {
        notes.push(`over-cap${tag}:${id}`);
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

    return links;
  };

  let links = resolve(raw?.video_ids, '');
  let deepLinks = keepIfDistinct(links, resolve(raw?.deep_video_ids, '-deep'));

  // ---- gate 3: a creator name narrows, it never unlocks ---------------------
  // The model is asked NOT to pre-filter by creator: it returns the topic's
  // normal lists plus the name it heard. That is what makes the honest miss
  // possible — the unfiltered lists are still in hand here, so "I have nothing
  // from X on this, but here is the topic" costs nothing and invents nothing.
  //
  // Sheet rows only (src/creator.js). A creator-scoped answer drawn from the
  // scan grid would be crediting a channel name rather than an attribution
  // Nick wrote, and "by X" is a promise about who is speaking.
  const askedCreator = typeof raw?.creator === 'string' ? raw.creator.trim() : '';
  let creatorScope = null;

  if (askedCreator) {
    const scoped = filterByCreator(links, askedCreator, index.byId);
    const scopedDeep = filterByCreator(deepLinks, askedCreator, index.byId);

    if (scoped.length || scopedDeep.length) {
      links = scoped;
      // Recomputed rather than reused: once both sides are narrowed to one
      // person they are often the same two videos, and the deep button has to
      // disappear on the same rule as everywhere else (§14.16).
      deepLinks = keepIfDistinct(scoped, scopedDeep);
      creatorScope = { name: askedCreator, matched: true };
    } else {
      // Not an error and not an empty answer: the topic list stays exactly as
      // it was, and the client says whose videos are missing from it.
      creatorScope = { name: askedCreator, matched: false };
      notes.push(`creator-miss:${askedCreator.slice(0, 40)}`);
    }
  }

  const topic = index.topics.has(raw?.topic) ? raw.topic : null;

  return {
    intent,
    topic,
    answerLang,
    copy,
    links,
    deepLinks,
    creatorScope,
    // Honest unmatched: no invented source, one real place to go next.
    fallback: links.length
      ? null
      : { url: DIRECTORY.url, label: DIRECTORY.label[answerLang] },
    notes,
  };
}
