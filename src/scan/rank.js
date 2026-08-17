/* ---------------------------------------------------------------------------
   Ranking and the register split — the mechanical half of §14.12.

   Pure, like match.js. Nothing in this file makes a quality judgement, and
   nothing in it may start to: the switchboard routes, it does not rate. Every
   number below comes from the clock or the view counter.
   --------------------------------------------------------------------------- */

/** Locked in the build brief §0.1. The +6 is a shock absorber: without it a
    two-week-old video with a viral spike divides by ~0 and buries everything.
    One constant, one place — turn it if the output feels wrong. */
export const RECENCY_MONTHS_OFFSET = 6;

/** Locked in §0/§3 of the brief. The grid lives inside the cached prompt, so
    the boxes have a ceiling: 16 topics × 2 registers × 12 is already a lot of
    tokens to pay for on every cold cache. */
export const MAX_PER_BOX = 12;

const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;

/** `views / (months_since_published + 6)` (§0.1). Views-per-month, softened. */
export function recencyScore(entry, now) {
  const published = Date.parse(entry?.published_at ?? '');
  const months = Number.isFinite(published) ? Math.max(0, (now - published) / MS_PER_MONTH) : 0;
  return (Number(entry?.views) || 0) / (months + RECENCY_MONTHS_OFFSET);
}

/** ISO-8601 duration (`PT1H2M3S`) → seconds. YouTube returns nothing else. */
export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso ?? ''));
  if (!m) return 0;
  const [, d, h, min, s] = m.map((v) => Number(v) || 0);
  return d * 86400 + h * 3600 + min * 60 + s;
}

/** mm:ss / h:mm:ss, the shape src/index.json already uses. */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const parts = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const [h, m, sec] = parts;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Register, per §14.4 and §0.2 of the brief: **median duration within one
 * creator's videos on one topic.** Below the median → start, above → deep.
 *
 * Two edges, both from §14.16, and both "serve it, say nothing":
 *   · one video   → start = deep = that video. The box never reports empty.
 *   · odd count   → the median video itself sits in BOTH boxes. Picking a side
 *                   would be a judgement, and we do not make those.
 */
export function splitByRegister(entries) {
  if (!entries.length) return { start: [], deep: [] };
  if (entries.length === 1) return { start: [...entries], deep: [...entries] };

  const sorted = [...entries].sort((a, b) => a.duration_seconds - b.duration_seconds);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return { start: sorted.slice(0, mid), deep: sorted.slice(mid) };
  }
  return {
    start: sorted.slice(0, mid + 1),
    deep: sorted.slice(mid), // the median video appears in both, on purpose
  };
}

/**
 * Everything a creator has on one topic → their two register buckets, with the
 * register stamped onto each entry.
 */
export function assignRegisters(entriesByCreator) {
  const out = [];
  for (const entries of entriesByCreator.values()) {
    const { start, deep } = splitByRegister(entries);
    for (const entry of start) out.push({ ...entry, register: 'start' });
    for (const entry of deep) out.push({ ...entry, register: 'deep' });
  }
  return out;
}

/**
 * One topic's entries → the two ranked boxes that get written to KV.
 *
 * Ordering is recency-weighted views and nothing else. §14.12 also asks for
 * "creators from the list first, outside it only if empty" — that is satisfied
 * structurally here rather than by a sort key, because the scan never looks
 * outside the list in the first place (§14.12b source-list). Everyone in this
 * array is already a roster creator.
 *
 * Pins go on top and blocklisted ids are gone, both before the cap, so an
 * editorial pin can never be pushed out by the ceiling.
 */
export function buildBoxes({ entries, topic, pins = [], blocklist = [], now, cap = MAX_PER_BOX }) {
  const blocked = new Set(blocklist);
  const boxes = { start: [], deep: [] };

  for (const register of ['start', 'deep']) {
    const pinnedIds = pins
      .filter((pin) => pin?.topic === topic && (!pin.register || pin.register === register))
      .map((pin) => pin.video_id);

    const pool = entries.filter((e) => e.register === register && !blocked.has(e.id));
    const scored = pool
      .map((entry) => ({ ...entry, score: recencyScore(entry, now) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    const pinned = pinnedIds
      .map((id) => scored.find((entry) => entry.id === id))
      .filter(Boolean)
      .map((entry) => ({ ...entry, pinned: true }));

    const rest = scored.filter((entry) => !pinnedIds.includes(entry.id));
    boxes[register] = [...pinned, ...rest].slice(0, cap);
  }

  return boxes;
}
