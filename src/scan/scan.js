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
import { assignRegisters, buildBoxes, parseDuration, formatDuration, MAX_PER_BOX } from './rank.js';

export const SCHEMA_VERSION = 2;

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
export async function runScan({ curation, client, state = new Map(), now = Date.now(), only = null }) {
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
    const ids = await client.listUploads(host.uploads_playlist_id, {
      since: state.get(`host:${host.handle}`)?.lastPublishedAt ?? null,
    });
    hostVideos.push(...(await client.listVideos(ids)));
  }

  // ---- per creator: gather, attribute, match -------------------------------
  const byTopic = new Map(); // topic → Map(creatorId → entry[])
  const nextState = new Map(state);

  for (const creator of creators) {
    if (!creator.uploads_playlist_id) {
      notes.push(`creator-unresolved:${creator.id}`);
      continue;
    }

    const watermark = state.get(creator.id)?.lastPublishedAt ?? null;
    const ownIds = await client.listUploads(creator.uploads_playlist_id, { since: watermark });
    const own = (await client.listVideos(ownIds)).map((video) => ({ video, source: 'own' }));

    // Guest appearances: a trusted host's video counts for this creator only
    // if the creator is identifiably the speaker (§14.12b). Conservative by
    // instruction — losing a guest video beats crediting the wrong person.
    const guest = hostVideos
      .filter((video) => isLikelySpeaker(video, creator.name))
      .map((video) => ({ video, source: 'trusted-host' }));

    let newest = watermark;
    for (const { video, source } of [...own, ...guest]) {
      if (video.published_at && (!newest || video.published_at > newest)) newest = video.published_at;

      for (const { topic, matchedOn } of matchTopics(video, creator.topics, aliasesByTopic)) {
        const perCreator = byTopic.get(topic) ?? new Map();
        const list = perCreator.get(creator.id) ?? [];
        list.push(toEntry(video, creator, topic, matchedOn, source));
        perCreator.set(creator.id, list);
        byTopic.set(topic, perCreator);
      }
    }

    nextState.set(creator.id, {
      lastPublishedAt: newest,
      uploads_playlist_id: creator.uploads_playlist_id,
    });
  }

  // ---- per topic: register split, then rank --------------------------------
  const grid = new Map();
  const counts = {};

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

  const meta = {
    schema_version: SCHEMA_VERSION,
    lastScan: new Date(now).toISOString(),
    topics: [...byTopic.keys()].sort(),
    counts,
    cap: MAX_PER_BOX,
    quota_units: client.unitsUsed,
    notes,
  };

  return { grid, meta, state: nextState };
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
