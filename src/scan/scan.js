/* ---------------------------------------------------------------------------
   The scan itself: curation.json + YouTube → the grid.

   Written against an injected client and an injected clock, so the whole flow
   can be exercised in Node with a stub (test/scan.test.mjs) exactly the way
   the router already is. The worker supplies the real ones.

   Flow (brief §2):

     for each creator:
       sources = own uploads playlist + trusted hosts
       fetch videos newer than that creator's watermark
       match each video against ONLY that creator's declared topics
     for each topic:
       per creator: median duration → start / deep
       rank by recency-weighted views, pin, block, cap
     write grid:{topic}:{register}, grid:_meta, scan:state:{creator}
   --------------------------------------------------------------------------- */

import { buildAliasIndex, matchTopics, isLikelySpeaker } from './match.js';
import {
  assignRegisters,
  buildBoxes,
  parseDuration,
  formatDuration,
  MAX_PER_BOX,
  MIN_DURATION_SECONDS,
} from './rank.js';

export const SCHEMA_VERSION = 2;

/** First-scan ceiling per creator, agreed 18/08/2026. Dave Mac alone has 2,699
    uploads; pulling every one of them to keep twelve per box is quota we never
    get back. The most recent 300 is six playlist pages, and the weekly
    incremental picks up everything after that. */
export const INITIAL_INGEST_CAP = 300;

/** Per-creator store, so a batch never has to re-read what it already knows. */
export const videosKey = (creatorId) => `scan:videos:${creatorId}`;

/** Merge what we had with what we just fetched. Keyed on id+topic because one
    video legitimately appears under several topics, and freshly-fetched wins so
    view counts move. */
function mergeEntries(previous, fresh) {
  const byKey = new Map(previous.map((entry) => [`${entry.id}:${entry.topic}`, entry]));
  for (const entry of fresh) byKey.set(`${entry.id}:${entry.topic}`, entry);
  return [...byKey.values()];
}

export const gridKey = (topic, register) => `grid:${topic}:${register}`;
export const stateKey = (creatorId) => `scan:state:${creatorId}`;
export const META_KEY = 'grid:_meta';

/** One API video + the creator it is being credited to → one grid entry. */
function toEntry(video, creator, topic, matchedOn, source) {
  const seconds = parseDuration(video.duration_iso);
  return {
    id: video.id,
    topic,
    type: 'conceptual',
    creator: creator.name,
    creator_id: creator.id,
    title: video.title,
    // Rebuilt from the id, never taken from a payload — the same rule the
    // router lives by. The model still never sees this field.
    url: `https://www.youtube.com/watch?v=${video.id}`,
    duration: formatDuration(seconds),
    duration_seconds: seconds,
    views: video.views,
    published_at: video.published_at,
    lang: video.lang || 'en',
    // null = the model writes the label under the link-label rules (§8). A
    // scan cannot produce our framing, and it must not try.
    label: null,
    matched_on: matchedOn,
    source,
  };
}

/**
 * @param {object}   args.curation   parsed curation.json
 * @param {object}   args.client     createClient() from ./youtube.js
 * @param {Map}      args.state      creator id → { lastPublishedAt, uploads_playlist_id }
 * @param {number}   args.now        Date.now(), injected for testability
 * @param {string[]} [args.only]     limit to these creator ids (batching)
 */
export async function runScan({
  curation,
  client,
  state = new Map(),
  existing = new Map(),
  now = Date.now(),
  only = null,
}) {
  const aliasesByTopic = buildAliasIndex(curation.topics);
  const creators = (curation.creators ?? []).filter((c) => !only || only.includes(c.id));
  const notes = [];

  // ---- trusted hosts, fetched once and shared across every creator ---------
  // A host's catalogue is pulled ONE time per scan, not once per creator: 27
  // creators × the same channel would be 27× the quota for the same videos.
  const hostVideos = [];
  for (const host of curation.trusted_hosts ?? []) {
    if (!host?.uploads_playlist_id) {
      notes.push(`trusted-host-unresolved:${host?.handle ?? '?'}`);
      continue;
    }
    const hostWatermark = state.get(`host:${host.handle}`)?.lastPublishedAt ?? null;
    const ids = await client.listUploads(host.uploads_playlist_id, {
      since: hostWatermark,
      maxVideos: hostWatermark ? Infinity : INITIAL_INGEST_CAP,
    });
    hostVideos.push(...(await client.listVideos(ids)));
  }

  // ---- per creator: gather, attribute, match -------------------------------
  // Seeded with everything already known, INCLUDING creators this run is not
  // scanning. Without that, an incremental run — or a batch narrowed with
  // `only` — would rebuild the grid out of this week's uploads alone and quietly
  // delete every video it did not just fetch.
  // Seeded from what is already known, MINUS anything now under the duration
  // floor: the store is rewritten from this, so old Shorts leave for good
  // rather than being filtered out of the grid on every future scan.
  let droppedShort = 0;
  const entriesByCreator = new Map();
  for (const [creatorId, stored] of existing) {
    const kept = stored.filter((entry) => (entry.duration_seconds ?? 0) >= MIN_DURATION_SECONDS);
    droppedShort += stored.length - kept.length;
    entriesByCreator.set(creatorId, kept);
  }
  const nextState = new Map(state);

  for (const creator of creators) {
    if (!creator.uploads_playlist_id) {
      notes.push(`creator-unresolved:${creator.id}`);
      continue;
    }

    const watermark = state.get(creator.id)?.lastPublishedAt ?? null;
    const ownIds = await client.listUploads(creator.uploads_playlist_id, {
      since: watermark,
      // First pass is capped; after that the watermark makes the cap moot.
      maxVideos: watermark ? Infinity : INITIAL_INGEST_CAP,
    });
    const own = (await client.listVideos(ownIds)).map((video) => ({ video, source: 'own' }));

    // Guest appearances: a trusted host's video counts for this creator only
    // if the creator is identifiably the speaker (§14.12b). Conservative by
    // instruction — losing a guest video beats crediting the wrong person.
    const guest = hostVideos
      .filter((video) => isLikelySpeaker(video, creator.name))
      .map((video) => ({ video, source: 'trusted-host' }));

    let newest = watermark;
    const fresh = [];
    for (const { video, source } of [...own, ...guest]) {
      if (video.published_at && (!newest || video.published_at > newest)) newest = video.published_at;
      // Too short to be a way into anything (§ MIN_DURATION_SECONDS). Dropped
      // here so it never reaches the store, and again at grouping below so
      // anything a previous scan already saved goes too.
      if (parseDuration(video.duration_iso) < MIN_DURATION_SECONDS) continue;
      for (const { topic, matchedOn } of matchTopics(video, creator.topics, aliasesByTopic)) {
        fresh.push(toEntry(video, creator, topic, matchedOn, source));
      }
    }
    entriesByCreator.set(creator.id, mergeEntries(existing.get(creator.id) ?? [], fresh));

    nextState.set(creator.id, {
      lastPublishedAt: newest,
      uploads_playlist_id: creator.uploads_playlist_id,
    });
  }

  // ---- per topic: register split, then rank --------------------------------
  const byTopic = new Map(); // topic → Map(creatorId → entry[])
  for (const [creatorId, entries] of entriesByCreator) {
    for (const entry of entries) {
      const perCreator = byTopic.get(entry.topic) ?? new Map();
      perCreator.set(creatorId, [...(perCreator.get(creatorId) ?? []), entry]);
      byTopic.set(entry.topic, perCreator);
    }
  }

  // EVERY curated topic gets a key, empty ones included. Writing only the
  // topics that happen to have entries leaves stale keys behind: when the
  // duration floor emptied seed-oils, its old box — six Ken Berry Shorts —
  // simply survived, because nothing overwrote it. An empty array is a fact
  // about the topic and has to be written like any other.
  const grid = new Map();
  const counts = {};
  for (const topic of curation.topics ?? []) {
    grid.set(gridKey(topic.id, 'start'), []);
    grid.set(gridKey(topic.id, 'deep'), []);
    counts[topic.id] = { start: 0, deep: 0 };
  }

  for (const [topic, perCreator] of byTopic) {
    const withRegister = assignRegisters(perCreator);
    const boxes = buildBoxes({
      entries: withRegister,
      topic,
      pins: curation.pins ?? [],
      blocklist: curation.blocklist ?? [],
      now,
    });
    grid.set(gridKey(topic, 'start'), boxes.start);
    grid.set(gridKey(topic, 'deep'), boxes.deep);
    counts[topic] = { start: boxes.start.length, deep: boxes.deep.length };
  }

  // Per-creator and pre-cap numbers, so a dry run can show WHY a topic is thin:
  // "nobody matched" and "twelve matched and the cap took the rest" look
  // identical in the final counts and mean opposite things.
  const perCreator = {};
  for (const creator of creators) {
    const entries = entriesByCreator.get(creator.id) ?? [];
    const topics = {};
    for (const entry of entries) topics[entry.topic] = (topics[entry.topic] ?? 0) + 1;
    perCreator[creator.id] = { matched: entries.length, topics };
  }
  const preCap = {};
  for (const [topic, byCreator] of byTopic) {
    preCap[topic] = [...byCreator.values()].reduce((n, list) => n + list.length, 0);
  }

  const meta = {
    schema_version: SCHEMA_VERSION,
    scanned: creators.map((c) => c.id),
    per_creator: perCreator,
    pre_cap: preCap,
    lastScan: new Date(now).toISOString(),
    topics: [...byTopic.keys()].sort(),
    counts,
    cap: MAX_PER_BOX,
    min_duration_seconds: MIN_DURATION_SECONDS,
    dropped_too_short: droppedShort,
    quota_units: client.unitsUsed,
    notes,
  };

  // matched_on breakdown, so the quality of title-matching is visible instead
  // of assumed (§14.8 rests on "titles here are very descriptive").
  const allEntries = [...grid.values()].flat();
  meta.matched_on = {
    title: allEntries.filter((e) => e.matched_on === 'title').length,
    description: allEntries.filter((e) => e.matched_on === 'description').length,
  };
  meta.sources = {
    own: allEntries.filter((e) => e.source === 'own').length,
    trusted_host: allEntries.filter((e) => e.source === 'trusted-host').length,
  };

  return { grid, meta, state: nextState, entriesByCreator };
}

/**
 * Link-rot pass (brief §5): every id already in the grid, checked for still
 * being public. Runs on the same cron because the alternative is a growing
 * pile of dead links, which is what §14.10 promoted from nice-to-have to
 * necessary the moment the index went video-level.
 */
export async function pruneDeadLinks({ grid, client }) {
  const ids = [...new Set([...grid.values()].flat().map((entry) => entry.id))];
  if (!ids.length) return { removed: 0 };

  const alive = await client.filterAlive(ids);
  let removed = 0;

  for (const [key, entries] of grid) {
    const kept = entries.filter((entry) => alive.has(entry.id));
    removed += entries.length - kept.length;
    grid.set(key, kept);
  }
  return { removed };
}
