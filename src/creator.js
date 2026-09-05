/* ---------------------------------------------------------------------------
   Creator-scoped queries — "insulin by Paul Mason", «χοληστερίνη από τον Berry».

   The model reads the question and hands over a NAME; everything below is
   code. Same division of labour as the rest of the bot: the model matches, the
   router verifies (src/router.js). A name is free text a stranger typed, so it
   never selects videos by itself — it filters a list the router already built.

   Everything here is pure, so test/creator.test.mjs can exercise it in Node.

   ⚠ THE MATCH IS ANCHORED ON THE SURNAME, NOT ON "contains".
   A plain substring test looks obvious and fails on the real sheet: one cell
   credits «Dr Paul Mason & Dr Chaffee» — surname only, no first name — while
   the roster spells him «Dr. Anthony Chaffee». Neither string contains the
   other in either direction. Matching the last token instead catches it, and
   still keeps Robert Kiltz and Robert Lustig apart.

   ⚠ WHY "coach" IS NOT STRIPPED (decision, 04/09/2026)
   `Dr.` is a title; `Coach` is part of the name. Coach Stephen and Coach
   Carnivore Cam are called that. Stripping it would leave the second one as
   "Carnivore Cam", which is nobody. So the prefix list holds medical titles
   only — deliberately short.
   --------------------------------------------------------------------------- */

/** Written to also catch "Dr.Shawn Baker" (no space) and "Dr Paul Mason" (no
    period), because the live sheet contains both. Anchored at a word start so
    it can never eat the middle of a name. */
/* ⚠ Longest alternative FIRST. Regex alternation is ordered, so `prof` before
   `professor` matches the short one and leaves "essor" glued to the name. A
   test covers it, because the failure is silent and looks like a bad name. */
const TITLE_RE = /(?:^|\s)(?:professor|doctor|prof|dr)\.?\s*/g;

/** People inside one cell: "Kelly Hogan, Laura Spath & Brandon Crouch" is three
    of them, with two different separators in the same string. */
const SEPARATOR_RE = /\s*(?:,|&|\+|\band\b|\bκαι\b)\s*/giu;

const MAX_NAME = 80;

/**
 * Lower-case, unaccented, title-free.
 *
 * Apostrophes and hyphens SURVIVE: turning them into spaces would split
 * «Amber O'Hearn» into two tokens and make her surname "hearn", which is not
 * her name and would collide with anyone else ending in it.
 */
export function normalizeName(value) {
  return String(value ?? '')
    .slice(0, MAX_NAME)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9'’\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One person's name → its tokens, titles removed. */
export function nameTokens(value) {
  return normalizeName(value)
    .replace(TITLE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * A `creator` cell → the people credited in it.
 *
 * Each piece is trimmed on its own. The sheet's trailing spaces sit on the
 * LAST person in a compound cell («Dr. Georgia Ede, Dr.Shawn Baker »), which a
 * single trim of the whole string would handle but a split would otherwise
 * carry into the token list.
 */
export function splitCreators(cell) {
  return String(cell ?? '')
    .split(SEPARATOR_RE)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Do these two names refer to the same person?
 *
 *   · surnames must agree — always, no exceptions
 *   · if only one side gives a first name, the surname is enough
 *     («Dr Chaffee» is the sheet's way of writing Anthony Chaffee)
 *   · if BOTH give a first name, it must agree
 *     (this is what keeps Robert Kiltz and Robert Lustig apart)
 *
 * Deliberately no fuzzy distance and no nicknames: a wrong creator is worse
 * than a miss, because a miss falls back to the topic and says so, while a
 * wrong one silently credits the wrong person.
 */
export function isSamePerson(a, b) {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (!left.length || !right.length) return false;

  if (left.join(' ') === right.join(' ')) return true;
  if (left[left.length - 1] !== right[right.length - 1]) return false;
  if (left.length === 1 || right.length === 1) return true;
  return left[0] === right[0];
}

/**
 * Does this entry's `creator` cell credit the asked-for person?
 *
 * An interview counts for EVERY name on it (§ brief): «Dr. Ken Berry, Ben
 * Bikman» answers "by Berry" and "by Bikman" alike. That is the whole reason
 * the cell is split before it is compared.
 */
export function creditsCreator(creatorCell, asked) {
  if (!String(asked ?? '').trim()) return false;
  return splitCreators(creatorCell).some((person) => isSamePerson(person, asked));
}

/**
 * Narrow a resolved link list to one creator.
 *
 * Sheet rows only, on purpose. The scan grid credits whatever the channel is
 * called, and a creator-scoped answer built out of that would be crediting a
 * channel name rather than a curated line Nick wrote. The sheet is the surface
 * where he owns the attribution, so it is the only one that answers "by X".
 *
 * Returns the matches, or an EMPTY array — never the unfiltered list. The
 * caller decides what a miss means; this function does not soften it.
 */
export function filterByCreator(links, asked, byId) {
  if (!String(asked ?? '').trim()) return links;
  return links.filter((link) => {
    const entry = byId?.get?.(link.id);
    if (!entry || entry.source !== 'sheet') return false;
    return creditsCreator(entry.creator ?? link.creator, asked);
  });
}
