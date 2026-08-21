/* ---------------------------------------------------------------------------
   Topic matching — the half of the scan that decides what a video is about.

   Pure: no fetch, no env, no clock. Everything here is exercised directly by
   test/scan.test.mjs, because this is where a quiet mistake would be most
   expensive — a wrongly-tagged video is a wrong answer with a real link on it.

   Two properties are deliberate, not incidental:

     1. The candidate space is CLOSED before matching starts. A video is only
        ever tested against the topics its own creator declares in
        curation.json — never against all sixteen. Georgia Ede's videos cannot
        land anywhere but mental-health, whatever her titles happen to say.
     2. Matching is whole-word, never substring. "gut" must not match "August",
        "salt" must not match "assault". This is the entire reason the alias
        lists can stay short and readable.
     3. TITLE ONLY. Descriptions are not a matching source and must not become
        one again. The 18/08 dry run settled it with numbers: 73% of matches
        came from descriptions, and Sten Ekberg alone produced 975 of them —
        roughly every one of his videos landing in exercise AND food-list AND
        diabetes at once, because his description boilerplate names all three.
        A description says what a channel is about; a title says what a video
        is about, and the grid is made of videos.
   --------------------------------------------------------------------------- */

/** Lowercase, strip Greek/Latin accents, flatten punctuation to spaces.
    NFD splits a letter from its accent; the range below deletes the accents,
    so «ΧΟΛΗΣΤΕΡΊΝΗ», «χοληστερίνη» and «Χοληστερινη» all become one string. */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Whole-word/phrase test against already-normalized haystack + needle. */
function containsPhrase(haystack, phrase) {
  if (!phrase) return false;
  // Both sides are normalized to single-spaced words, so padding turns a
  // word-boundary test into a plain substring test — no regex, no escaping,
  // and no surprises from a creator putting a hyphen in a title.
  return ` ${haystack} `.includes(` ${phrase} `);
}

/**
 * Which of a creator's declared topics does this video belong to?
 *
 * @param {{title: string, description?: string}} video
 * @param {string[]} creatorTopics  topic ids from curation.json (the closed set)
 * @param {Map<string, string[]>} aliasesByTopic  topic id → normalized aliases
 * @returns {Array<{topic: string, matchedOn: 'title'|'description'}>}
 */
export function matchTopics(video, creatorTopics, aliasesByTopic) {
  const title = normalize(video?.title);
  const hits = [];

  for (const topic of creatorTopics ?? []) {
    const aliases = aliasesByTopic.get(topic);
    if (!aliases) continue; // a topic id with no entry is a curation bug, not a match
    if (aliases.some((alias) => containsPhrase(title, alias))) {
      // matched_on stays in the shape even though it is now always "title" —
      // the field is what let us measure the description experiment and kill
      // it, and it should stay measurable if a second source is ever proposed.
      hits.push({ topic, matchedOn: 'title' });
    }
  }

  return hits;
}

/**
 * Is this creator identifiably the speaker in a trusted-host video?
 *
 * Only ever asked about videos from a trusted host (§14.12b) — never about a
 * creator's own uploads. The rule from the brief is conservative on purpose:
 * **when in doubt, leave it out.** Losing a guest appearance costs us one
 * video; attributing someone else's video to a creator is a wrong answer with
 * their name on it.
 */
export function isLikelySpeaker(video, creatorName) {
  // This one DOES read the description, and should: "who is in this video" is
  // the thing a description states plainly. It is an attribution check, not a
  // topic match — the topic still has to come from the title.
  const haystack = `${normalize(video?.title)} ${normalize(video?.description)}`;
  const full = normalize(String(creatorName).replace(/^(dr|doctor|coach)\.?\s+/i, ''));
  if (!full) return false;
  if (containsPhrase(haystack, full)) return true;

  // A surname alone is enough only when it is distinctive. "Lustig" yes;
  // "Mac" or "Cho" no — those would match half the internet.
  const surname = full.split(' ').at(-1);
  return surname.length >= 5 && containsPhrase(haystack, surname);
}

/**
 * Plural variants of a single word. Deliberately NOT a stemmer.
 *
 * A stemmer would take "fasting" to "fast" and then match "breakfast", which is
 * the exact class of false positive the title-only rule was brought in to stop.
 * This only ever goes the safe direction — singular to plural — and only with
 * rules that cannot produce a shorter or more generic word.
 *
 * Irregular plurals (γυναίκα → γυναίκες is regular here, but εξέταση →
 * εξετάσεις is not) belong in the alias list by hand. This covers the common
 * case, not every case, and the alias list is where the exceptions live.
 */
function pluralVariants(word) {
  const out = new Set();
  if (word.length < 4) return out; // "if", "gut", "upf" — too short to be safe

  if (/[a-z]$/.test(word)) {
    if (/(s|x|z|ch|sh)$/.test(word)) out.add(`${word}es`);
    else if (/[^aeiou]y$/.test(word)) out.add(`${word.slice(0, -1)}ies`);
    else out.add(`${word}s`);
  }

  // Greek, the two endings that are regular enough to automate. Anything else
  // (and every genitive) goes in the alias list explicitly.
  if (/[αη]$/.test(word)) out.add(`${word.slice(0, -1)}ες`);
  else if (/ος$/.test(word)) out.add(`${word.slice(0, -2)}οι`);

  return out;
}

/** An alias plus its plural forms. Only the LAST word is pluralised: that is
    where an English plural lands ("beginner guide" → "beginner guides"), and
    pluralising the middle of a phrase produces nothing a human would type. */
export function aliasVariants(alias) {
  const words = alias.split(' ');
  const last = words.at(-1);
  const variants = new Set([alias]);
  for (const plural of pluralVariants(last)) {
    variants.add([...words.slice(0, -1), plural].join(' '));
  }
  return [...variants];
}

/** curation.topics → the normalized lookup the matcher wants. Aliases are
    normalized once here rather than per video: this runs across thousands of
    titles per scan. */
export function buildAliasIndex(topics) {
  const byTopic = new Map();
  for (const topic of topics ?? []) {
    if (!topic?.id) continue;
    const aliases = new Set();
    for (const alias of [topic.id.replace(/-/g, ' '), ...(topic.aliases ?? [])]) {
      const normalized = normalize(alias);
      if (!normalized) continue;
      for (const variant of aliasVariants(normalized)) aliases.add(variant);
    }
    byTopic.set(topic.id, [...aliases]);
  }
  return byTopic;
}
