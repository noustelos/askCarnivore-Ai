/* ---------------------------------------------------------------------------
   Highlights — the curated list, read from the SAME sheet the override reads.

   Named Highlights and not "What's New": `pin` lifts a video above the
   calendar, so the order is editorial first and chronological second. A name
   promising recency would promise something the sort does not deliver.

   This is a second, independent projection of one CSV. It does not touch the
   override layer and the override layer does not know it exists:

     · `active` is the bot's switch. It decides what the index serves.
     · `blog`   is this page's switch. It decides what Highlights shows.

   A row can be one, the other, both or neither. Deliberately independent —
   parking a video for the bot should not silently pull it off the page, and
   putting something on the page should not quietly feed it to the model.

   Everything here is pure: parse, sort, escape, render. The fetching, the KV
   cache and the Response live in functions/highlights.js, so all of this runs under
   `node --test` with no Cloudflare and no network.

   Two rules carried over from the rest of the bot, not re-argued here:

     · The URL in the sheet is not trusted as a URL. The video id comes out of
       it and the link is rebuilt, exactly as the router and the override do.
     · Nothing from the sheet reaches the HTML unescaped. Every cell is a
       person typing into a spreadsheet, which is an input like any other.
   --------------------------------------------------------------------------- */

import { parseCsv, videoIdFrom, versionOf } from './sheet.js';

export { versionOf };

/** Its own KV key. The override's key holds an already-filtered, already-
    grouped structure with these columns thrown away — reading it here would
    quietly show a subset of what Nick picked. */
export const BLOG_KEY = 'blog:sheet';

const MAX_ROWS = 500;
const MAX_TITLE = 200;
const MAX_CREATOR = 80;
const MAX_FORMAT = 24;
const MAX_NOTES = 20;

/* Same treatment the override gives a cell: no control characters, no
   newlines, collapsed whitespace, hard length cap. */
function clean(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** YYYY-MM-DD and a real calendar date, or null. "2026-13-40" is not a date. */
export function isoDate(value) {
  const raw = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === raw ? raw : null;
}

/**
 * CSV text → { items, version, notes }, sorted for display.
 *
 * Columns are found BY NAME, lower-cased and trimmed, so the sheet's column
 * order can change without breaking anything — and so the four new columns can
 * sit anywhere in it. A row with no `blog` cell at all reads as empty, which is
 * not "yes", which means every row that predates this feature stays off the
 * page until someone opts it in.
 */
export function parseWhatsNew(text) {
  const notes = [];
  const table = parseCsv(text);
  if (!table.length) return { items: [], version: versionOf(text), notes: ['empty-csv'] };

  const header = table[0].map((name) => name.trim().toLowerCase());
  const at = (row, name) => {
    const index = header.indexOf(name);
    return index === -1 ? '' : row[index] ?? '';
  };

  if (!header.includes('blog')) notes.push('missing-columns:blog');

  const items = [];
  for (const row of table.slice(1, MAX_ROWS + 1)) {
    // The only switch. `active` is not consulted: the two surfaces are
    // independent, see the header of this file.
    if (clean(at(row, 'blog'), 10).toLowerCase() !== 'yes') continue;

    const id = videoIdFrom(at(row, 'url'));
    const title = clean(at(row, 'title'), MAX_TITLE);

    // Refusals are reported rather than guessed at, the same way the override
    // reports them: a row that looks picked but shows nothing is the one
    // failure Nick could not diagnose from the outside.
    if (!id) { notes.push(`bad-url:${title.slice(0, 40)}`); continue; }
    if (!title) { notes.push(`no-title:${id}`); continue; }

    const date = isoDate(at(row, 'date'));
    // A typo in a date must not delete an editorial choice. The row shows,
    // at the bottom, and says so in the notes.
    if (!date && clean(at(row, 'date'), 20)) notes.push(`bad-date:${id}`);

    items.push({
      id,
      title,
      creator: clean(at(row, 'creator'), MAX_CREATOR) || 'Unknown',
      duration: clean(at(row, 'duration'), 12) || null,
      // Sort key only. It is the date the row was added to the sheet, which
      // says nothing a reader wants — the real publication date is on YouTube,
      // one tap away. It orders the page and never appears on it.
      date,
      topic: clean(at(row, 'topic'), 60).toLowerCase() || null,
      format: clean(at(row, 'format'), MAX_FORMAT) || null,
      pinned: clean(at(row, 'pin'), 10).toLowerCase() === 'yes',
      // Rebuilt from the id — the sheet's URL is evidence, not the link.
      url: `https://www.youtube.com/watch?v=${id}`,
    });
  }

  return { items: sortWhatsNew(items), version: versionOf(text), notes: notes.slice(0, MAX_NOTES) };
}

/**
 * Pinned first, then everything else newest-first, undated last.
 *
 * `pin` is an editorial override, so it outranks the calendar completely — but
 * only against the calendar: pinned rows are still sorted among themselves by
 * date, so pinning several does not scramble them.
 */
export function sortWhatsNew(items) {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.date && b.date) return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    if (a.date) return -1; // dated beats undated
    if (b.date) return 1;
    return 0;
  });
}

/** Topic ids carry a bilingual label in curation.json — "Cholesterol / χοληστερίνη".
    This page is English, like /embed, so the pill takes the half before the
    slash. A label with no slash is used whole. */
export function topicPill(topicId, topics = []) {
  if (!topicId) return null;
  const found = topics.find((t) => t.id === topicId);
  if (!found?.label) return null;
  return found.label.split('/')[0].trim() || null;
}

/** Nothing from the sheet reaches the page unescaped. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The security headers for this route.
 *
 * THIS IS WHY IT IS A FUNCTION AND NOT A LINE IN `_headers`: Cloudflare does
 * not apply `_headers` to responses generated by Pages Functions. Every other
 * page on this site gets its policy from that file; /highlights cannot, so it
 * carries its own — including the headers the `/*` block hands to everything
 * else, because that block does not reach here either.
 *
 * Left out, /highlights would ship with no CSP AND no frame-ancestors, which
 * does not fail loudly: the portal's iframe would work perfectly while every
 * other site on the internet could frame this page too. test/blog.test.mjs
 * exists to keep that from happening quietly.
 */
export function securityHeaders() {
  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': [
      "default-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "base-uri 'none'",
      "form-action 'none'",
      // Our half of §16, same as /embed: askcarnivores.com may frame this, and
      // nobody else may. The portal sets frame-src on its own side.
      'frame-ancestors https://askcarnivores.com https://www.askcarnivores.com',
    ].join('; '),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
    // Minutes, not a deploy: the sheet is edited while the site is live.
    'cache-control': 'public, max-age=300',
  };
}

/**
 * items → one card.
 *
 * The topic pill and the format pill are two different claims and are styled
 * apart on purpose: topic is what the video is ABOUT, format is what it IS.
 * An empty format cell means no second pill, not an empty one.
 */
function card(item, topics) {
  const topic = topicPill(item.topic, topics);
  // No date. The sheet's date is when Nick added the row, not when the video
  // came out, and showing it would answer a question nobody asked with a
  // number that is not the one they would expect.
  const meta = [item.creator, item.duration].filter(Boolean);
  const pills = [
    topic ? `<span class="pill pill--topic">${escapeHtml(topic)}</span>` : '',
    item.format ? `<span class="pill pill--format">${escapeHtml(item.format)}</span>` : '',
  ].join('');

  return `      <li class="card${item.pinned ? ' card--pinned' : ''}">
        <a class="card__link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">
          <h2 class="card__title">${escapeHtml(item.title)}</h2>
        </a>
        <p class="card__meta">${meta.map((m) => escapeHtml(m)).join(' · ')}</p>
        ${pills ? `<p class="card__pills">${pills}</p>` : ''}
      </li>`;
}

/**
 * The whole page, as a string.
 *
 * No script tag and no external anything: the CSP above says `default-src
 * 'self'` with no script-src, so this page could not run one if it wanted to.
 * That is the point of rendering here rather than in the browser — inside the
 * portal's frame, on a phone, this costs one request and no JavaScript.
 */
export function renderPage({ items = [], topics = [] } = {}) {
  const cards = items.length
    ? `<ul class="cards">\n${items.map((item) => card(item, topics)).join('\n')}\n    </ul>`
    : `<p class="empty">Nothing here yet. Check back soon.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Highlights — Ask Carnivore Ai</title>
<meta name="description" content="Hand-picked videos from the creators this bot draws on.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%A5%A9%3C/text%3E%3C/svg%3E">
<style>
  /* Inline, and it has to be: a Pages Function serves this route, so a
     stylesheet would be a second request for a page that is one screen of
     text. The style-src 'unsafe-inline' in the header above covers exactly
     this and nothing else — there is no script-src at all. */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* Eucalyptus, one step darker than the landing and the panel (31/08/2026).
     Same hue, lower light: this page is a list, and the cards have to lift off
     the ground rather than float on it. The wine palette this replaces was
     built the same way — a deep ground, a card a few points above it — so the
     relationships are carried over rather than re-invented:

       fg on card   11.15    soft on card  7.01
       fg on pill    7.73    card vs bg    1.26  (was 1.15 — a touch clearer)
       accent/card   5.43

     --fg and --fg-soft stay neutral warm greys on purpose. Tinting the text
     to match the ground is what makes a dark palette read as murky. */
  :root {
    --bg: hsl(160 16% 14%);
    --card: hsl(160 14% 20%);
    --fg: hsl(20 20% 97%);
    --fg-soft: hsl(20 12% 78%);
    --accent: hsl(160 40% 58%);
    --rule: hsl(160 12% 28%);
    --font: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Inter,
            Helvetica, Arial, sans-serif;
  }

  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font);
    font-size: 1rem;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    padding: 1.5rem 1.1rem 2.5rem;
  }

  .wrap { max-width: 46rem; margin: 0 auto; }

  .head { margin-bottom: 1.5rem; }
  .head h1 { font-size: 1.35rem; letter-spacing: -0.01em; }
  .head p { color: var(--fg-soft); font-size: 0.9rem; margin-top: 0.35rem; }

  .cards { list-style: none; display: grid; gap: 0.9rem; }

  .card {
    background: var(--card);
    border: 1px solid var(--rule);
    border-radius: 0.5rem;
    padding: 1rem 1.1rem;
  }

  /* Pinned is an editorial choice, so it gets a mark a person can see rather
     than just a position they cannot explain. */
  .card--pinned { border-left: 3px solid var(--accent); }

  .card__link { text-decoration: none; color: inherit; display: block; }
  .card__link:hover .card__title,
  .card__link:focus-visible .card__title { text-decoration: underline; }

  /* Large type and generous targets: the audience is the same 50+ readers the
     panel was built for, and this sits in the same frame. */
  .card__title { font-size: 1.0625rem; font-weight: 650; line-height: 1.35; }
  .card__meta { color: var(--fg-soft); font-size: 0.85rem; margin-top: 0.4rem; }
  .card__pills { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.7rem; }

  .pill {
    display: inline-block;
    padding: 0.2rem 0.6rem;
    border-radius: 1rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  /* Two pills, two meanings, two looks — topic is what it is about, format is
     what it is. They must never read as one list. */
  .pill--topic { background: hsl(160 30% 26%); color: var(--fg); }
  .pill--format { background: transparent; color: var(--fg-soft); border: 1px solid var(--rule); }

  .empty { color: var(--fg-soft); }

  .foot {
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid var(--rule);
    color: var(--fg-soft);
    font-size: 0.75rem;
  }
  .foot a { color: var(--fg-soft); }

  @media (min-width: 34rem) {
    body { padding: 2rem 1.5rem 3rem; }
    .head h1 { font-size: 1.6rem; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header class="head">
      <h1>Highlights</h1>
      <p>Picked by hand from the creators in the index.</p>
    </header>

    ${cards}

    <footer class="foot">
      <p>Every link goes to the creator's own channel on YouTube. Positions and
      personal experience, not medical advice.</p>
      <p><a href="https://askcarnivore.com" target="_blank" rel="noopener">Ask Carnivore Ai ↗</a></p>
    </footer>
  </div>
</body>
</html>
`;
}
