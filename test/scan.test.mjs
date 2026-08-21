/* ---------------------------------------------------------------------------
   Run with:  node --test test/scan.test.mjs      (no dependencies, no build)

   The scan makes no judgement calls, which means every rule it follows is
   checkable. These cover the ones that would fail quietly and expensively:
   a substring match tagging the wrong topic, a median split putting the long
   video in "start", a viral five-year-old burying a good recent one, and a
   guest video credited to whoever happens to be on the roster.
   --------------------------------------------------------------------------- */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { normalize, matchTopics, isLikelySpeaker, buildAliasIndex, aliasVariants } from '../src/scan/match.js';
import {
  recencyScore,
  parseDuration,
  formatDuration,
  splitByRegister,
  buildBoxes,
  MAX_PER_BOX,
  MAX_PER_CREATOR_PER_BOX,
} from '../src/scan/rank.js';
import { runScan, gridKey } from '../src/scan/scan.js';

const curation = JSON.parse(readFileSync(new URL('../src/curation.json', import.meta.url)));
const aliases = buildAliasIndex(curation.topics);

/* ---- the curation file itself ------------------------------------------- */

test('curation.json is coherent: closed list, known topics, a handle each', () => {
  assert.equal(curation.list_status, 'CLOSED_AT_27');
  // 27 on the roster, but four are excluded from the SCAN — interviews,
  // recipes and a dormant channel, none of which alias-matching can read. They
  // stay in the file with a reason rather than being deleted.
  assert.equal(curation.creators.length + curation.excluded_from_scan.length, 27);
  assert.equal(curation.excluded_from_scan.length, 4);
  for (const excluded of curation.excluded_from_scan) {
    assert.match(excluded.excluded_reason, /ΕΚΤΟΣ SCAN/, `${excluded.id} has no reason`);
  }
  assert.equal(curation.topics.length, 16);

  const topicIds = new Set(curation.topics.map((t) => t.id));
  for (const creator of curation.creators) {
    assert.ok(creator.handle?.startsWith('@'), `${creator.id} has no handle`);
    for (const topic of creator.topics) {
      assert.ok(topicIds.has(topic), `${creator.id} references unknown topic ${topic}`);
    }
  }
  // Every topic must be reachable, or the bot has a box it can never fill.
  const covered = new Set(curation.creators.flatMap((c) => c.topics));
  assert.deepEqual([...topicIds].filter((t) => !covered.has(t)), []);
});

/* ---- matching ------------------------------------------------------------ */

test('accents and case do not matter', () => {
  assert.equal(normalize('ΧΟΛΗΣΤΕΡΊΝΗ'), normalize('χοληστερίνη'));
  assert.equal(normalize('Keto-Flu!'), 'keto flu');
});

test('matching is whole-word: "gut" does not match "August"', () => {
  const hits = matchTopics(
    { title: 'What I ate in August', description: '' },
    ['autoimmune'],
    aliases,
  );
  assert.deepEqual(hits, []);
});

test('a video is only ever tested against ITS creator’s topics', () => {
  const video = { title: 'My cholesterol went up on carnivore', description: '' };
  // Georgia Ede declares mental-health only. Her title may say anything.
  assert.deepEqual(matchTopics(video, ['mental-health'], aliases), []);
  assert.deepEqual(
    matchTopics(video, ['cholesterol'], aliases).map((h) => h.topic),
    ['cholesterol'],
  );
});

test('the description is not a matching source — title or nothing', () => {
  const byTitle = matchTopics({ title: 'Insulin resistance explained', description: '' }, ['insulin'], aliases);
  assert.deepEqual(byTitle, [{ topic: 'insulin', matchedOn: 'title' }]);

  // This is the boilerplate case that produced 975 matches for one creator in
  // the 18/08 dry run: a description that lists every subject the channel ever
  // covers. It must match nothing.
  const boilerplate = {
    title: 'My Tuesday vlog',
    description: 'In this channel we cover insulin, diabetes, exercise and what to eat. #insulin',
  };
  assert.deepEqual(matchTopics(boilerplate, ['insulin', 'diabetes', 'exercise'], aliases), []);
});

test('one video can land in several topics', () => {
  const hits = matchTopics(
    { title: 'Insulin, diabetes and what to eat', description: '' },
    ['insulin', 'diabetes', 'food-list'],
    aliases,
  );
  assert.deepEqual(hits.map((h) => h.topic).sort(), ['diabetes', 'food-list', 'insulin']);
});

/* ---- the guest rule (§14.12b) ------------------------------------------- */

test('a guest video needs the creator named; in doubt it stays out', () => {
  const video = { title: 'Robert Lustig on sugar and the liver', description: '' };
  assert.equal(isLikelySpeaker(video, 'Robert Lustig'), true);
  assert.equal(isLikelySpeaker(video, 'Dr. Ken Berry'), false);

  // A short surname is never enough on its own — "Mac" and "Cho" would match
  // half of YouTube, and a wrong attribution is worse than a missing video.
  assert.equal(isLikelySpeaker({ title: 'Mac and cheese, carnivore style' }, 'Dave Mac'), false);
  assert.equal(isLikelySpeaker({ title: 'A talk with Judy Cho' }, 'Judy Cho'), true);
});

/* ---- register split (§14.4) --------------------------------------------- */

test('durations parse and render', () => {
  assert.equal(parseDuration('PT1H1M'), 3660);
  assert.equal(formatDuration(3660), '1:01:00');
  assert.equal(formatDuration(325), '5:25');
});

test('two videos: the shorter is start, the longer is deep', () => {
  const { start, deep } = splitByRegister([
    { id: 'long', duration_seconds: 3600 },
    { id: 'short', duration_seconds: 300 },
  ]);
  assert.deepEqual(start.map((e) => e.id), ['short']);
  assert.deepEqual(deep.map((e) => e.id), ['long']);
});

test('one video: start and deep are the same video, not an empty box', () => {
  const { start, deep } = splitByRegister([{ id: 'only', duration_seconds: 600 }]);
  assert.deepEqual(start.map((e) => e.id), ['only']);
  assert.deepEqual(deep.map((e) => e.id), ['only']);
});

test('odd count: the median video sits in both boxes rather than being judged', () => {
  const { start, deep } = splitByRegister([
    { id: 'a', duration_seconds: 100 },
    { id: 'b', duration_seconds: 500 },
    { id: 'c', duration_seconds: 900 },
  ]);
  assert.deepEqual(start.map((e) => e.id), ['a', 'b']);
  assert.deepEqual(deep.map((e) => e.id), ['b', 'c']);
});

/* ---- ranking (§14.12) ---------------------------------------------------- */

const NOW = Date.parse('2026-08-18T00:00:00Z');
const monthsAgo = (n) => new Date(NOW - n * 30 * 24 * 3600 * 1000).toISOString();

test('recency weighting: a good recent video is not buried by an old viral one', () => {
  const oldViral = { views: 1_000_000, published_at: monthsAgo(60) };
  const recentGood = { views: 200_000, published_at: monthsAgo(2) };
  assert.ok(recencyScore(recentGood, NOW) > recencyScore(oldViral, NOW));

  // What the +6 constant actually costs, written down rather than assumed:
  // the five-year-old million-view video is worth ~15k/month, so a two-month
  // -old video needs ~120k views to draw with it. That is the intended
  // trade-off — recency is a thumb on the scale, not a reset button — but it
  // is the number to turn if the grid ever feels stale or feels churny.
  const justAbove = { views: 125_000, published_at: monthsAgo(2) };
  const justBelow = { views: 115_000, published_at: monthsAgo(2) };
  assert.ok(recencyScore(justAbove, NOW) > recencyScore(oldViral, NOW));
  assert.ok(recencyScore(justBelow, NOW) < recencyScore(oldViral, NOW));
});

test('a box is ranked by score, capped, and never drops a pin', () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({
    id: `v${i}`,
    register: 'start',
    views: (i + 1) * 1000,
    published_at: monthsAgo(1),
  }));
  // v0 has the fewest views, so without the pin it would never survive the cap.
  const { start } = buildBoxes({
    entries,
    topic: 'insulin',
    pins: [{ topic: 'insulin', register: 'start', video_id: 'v0' }],
    now: NOW,
  });

  // Twenty videos, all from one creator: the per-creator share now decides the
  // size, not the box ceiling.
  assert.equal(start.length, 3);
  assert.equal(start[0].id, 'v0');
  assert.equal(start[0].pinned, true);
  assert.ok(start[1].views > start[2].views, 'the rest are ranked by score');
});

test('a box is cross-creator: no one may take more than their share', () => {
  // A dominant creator (huge view counts) against four modest ones. Without the
  // per-creator cap the whole box would be the first creator's tail.
  const loud = Array.from({ length: 20 }, (_, i) => ({
    id: `loud${i}`,
    creator_id: 'ekberg',
    register: 'start',
    views: 1_000_000 - i,
    published_at: monthsAgo(2),
  }));
  const others = ['berry', 'mason', 'cho', 'bikman'].map((who, i) => ({
    id: `q${i}`,
    creator_id: who,
    register: 'start',
    views: 1000,
    published_at: monthsAgo(2),
  }));

  const { start } = buildBoxes({ entries: [...loud, ...others], topic: 'insulin', now: NOW });
  const perCreator = start.reduce((acc, e) => ({ ...acc, [e.creator_id]: (acc[e.creator_id] ?? 0) + 1 }), {});

  assert.equal(perCreator.ekberg, MAX_PER_CREATOR_PER_BOX);
  assert.equal(Object.keys(perCreator).length, 5, 'every creator with something is represented');
});

test('a short box is fine — padding it from one creator is not', () => {
  const entries = Array.from({ length: 9 }, (_, i) => ({
    id: `v${i}`,
    creator_id: 'only-one',
    register: 'deep',
    views: 1000 * (9 - i),
    published_at: monthsAgo(3),
  }));
  const { deep } = buildBoxes({ entries, topic: 'women', now: NOW });
  assert.equal(deep.length, MAX_PER_CREATOR_PER_BOX);
});

test('a blocklisted video is gone from every box', () => {
  const entries = [
    { id: 'keep', register: 'deep', views: 10, published_at: monthsAgo(1) },
    { id: 'drop', register: 'deep', views: 999999, published_at: monthsAgo(1) },
  ];
  const { deep } = buildBoxes({ entries, topic: 'insulin', blocklist: ['drop'], now: NOW });
  assert.deepEqual(deep.map((e) => e.id), ['keep']);
});

/* ---- the whole flow, against a stub client ------------------------------ */

function stubClient({ uploads = {}, videos = [] }) {
  return {
    unitsUsed: 0,
    async listUploads(playlistId) {
      return uploads[playlistId] ?? [];
    },
    async listVideos(ids) {
      return videos.filter((v) => ids.includes(v.id));
    },
    async filterAlive(ids) {
      return new Set(ids);
    },
  };
}

test('end to end: two videos on one topic become a start box and a deep box', async () => {
  const testCuration = {
    topics: [{ id: 'insulin', aliases: ['insulin'] }],
    trusted_hosts: [],
    creators: [
      {
        id: 'ben-bikman',
        name: 'Ben Bikman',
        handle: '@benbikman',
        channel_id: 'UC1',
        uploads_playlist_id: 'UU1',
        topics: ['insulin'],
      },
    ],
  };
  const client = stubClient({
    uploads: { UU1: ['short', 'long', 'unrelated'] },
    videos: [
      { id: 'short', title: 'Insulin in five minutes', description: '', published_at: monthsAgo(2), duration_iso: 'PT5M', views: 50_000, lang: 'en' },
      { id: 'long', title: 'Insulin resistance, the full lecture', description: '', published_at: monthsAgo(3), duration_iso: 'PT1H', views: 40_000, lang: 'en' },
      { id: 'unrelated', title: 'A day in my kitchen', description: '', published_at: monthsAgo(1), duration_iso: 'PT8M', views: 90_000, lang: 'en' },
    ],
  });

  const { grid, meta, state } = await runScan({ curation: testCuration, client, now: NOW });

  assert.deepEqual(grid.get(gridKey('insulin', 'start')).map((e) => e.id), ['short']);
  assert.deepEqual(grid.get(gridKey('insulin', 'deep')).map((e) => e.id), ['long']);
  assert.equal(grid.get(gridKey('insulin', 'start'))[0].url, 'https://www.youtube.com/watch?v=short');
  assert.equal(grid.get(gridKey('insulin', 'start'))[0].label, null, 'the scan never writes our framing');
  assert.equal(meta.topics.length, 1);
  assert.ok(state.get('ben-bikman').lastPublishedAt, 'the watermark advances for the next run');
});

test('end to end: a trusted-host video is credited only to the named speaker', async () => {
  const testCuration = {
    topics: [{ id: 'insulin', aliases: ['insulin'] }],
    trusted_hosts: [{ handle: '@DoctorsToTrust', channel_id: 'UCH', uploads_playlist_id: 'UUH' }],
    creators: [
      { id: 'robert-lustig', name: 'Robert Lustig', handle: '@RobertLustigMD', channel_id: 'UC2', uploads_playlist_id: 'UU2', topics: ['insulin'] },
      { id: 'ken-berry', name: 'Dr. Ken Berry', handle: '@KenDBerryMD', channel_id: 'UC3', uploads_playlist_id: 'UU3', topics: ['insulin'] },
    ],
  };
  const client = stubClient({
    uploads: { UUH: ['guest'], UU2: [], UU3: [] },
    videos: [
      { id: 'guest', title: 'Robert Lustig on insulin', description: '', published_at: monthsAgo(1), duration_iso: 'PT30M', views: 10_000, lang: 'en' },
    ],
  });

  const { grid } = await runScan({ curation: testCuration, client, now: NOW });
  const box = grid.get(gridKey('insulin', 'start'));

  assert.equal(box.length, 1);
  assert.equal(box[0].creator, 'Robert Lustig');
  assert.equal(box[0].source, 'trusted-host');
});

test('an incremental run keeps what earlier runs found', async () => {
  // The failure this guards against: a weekly scan only fetches new uploads, so
  // rebuilding the grid from that alone would silently delete the whole back
  // catalogue. Same shape of bug when a batch narrows the run with `only`.
  const testCuration = {
    topics: [{ id: 'insulin', aliases: ['insulin'] }],
    trusted_hosts: [],
    creators: [
      { id: 'a', name: 'Creator A', handle: '@a', channel_id: 'UC1', uploads_playlist_id: 'UU1', topics: ['insulin'] },
      { id: 'b', name: 'Creator B', handle: '@b', channel_id: 'UC2', uploads_playlist_id: 'UU2', topics: ['insulin'] },
    ],
  };
  const existing = new Map([
    ['a', [{ id: 'old-a', topic: 'insulin', creator: 'Creator A', duration_seconds: 600, views: 5000, published_at: monthsAgo(10), url: 'u', title: 't' }]],
    ['b', [{ id: 'old-b', topic: 'insulin', creator: 'Creator B', duration_seconds: 600, views: 5000, published_at: monthsAgo(10), url: 'u', title: 't' }]],
  ]);
  const client = stubClient({
    uploads: { UU1: ['new-a'] },
    videos: [
      { id: 'new-a', title: 'Insulin update', description: '', published_at: monthsAgo(1), duration_iso: 'PT20M', views: 9000, lang: 'en' },
    ],
  });

  // Only creator "a" is scanned — b is not touched this run.
  const { grid } = await runScan({ curation: testCuration, client, existing, now: NOW, only: ['a'] });
  const ids = [...grid.values()].flat().map((e) => e.id);

  assert.ok(ids.includes('new-a'), 'the new video is added');
  assert.ok(ids.includes('old-a'), "creator A's earlier videos survive");
  assert.ok(ids.includes('old-b'), 'a creator outside the batch is not wiped');
});

test('plurals match, but nothing is stemmed', () => {
  // The whole point: "beginner" should find "Beginners", and "fasting" must
  // never become "fast" and start matching "breakfast".
  assert.deepEqual(
    matchTopics({ title: 'Carnivore Diet FAQ for Beginners' }, ['getting-started'], aliases).map((h) => h.topic),
    ['getting-started'],
  );
  assert.deepEqual(matchTopics({ title: 'What I eat for breakfast' }, ['fasting'], aliases), []);
  assert.deepEqual(matchTopics({ title: 'My breakfast routine' }, ['fasting'], aliases), []);

  // Greek: regular α/η → ες only.
  assert.deepEqual(aliasVariants('ορμόνη'), ['ορμόνη', 'ορμόνες']);
  // Too short to pluralise safely — "gut"/"upf" must not grow an "s" that
  // collides with something else.
  assert.deepEqual(aliasVariants('gut'), ['gut']);
});

test('nothing under three minutes reaches the grid', async () => {
  // The failure this prevents: cholesterol:start came back as twelve Shorts,
  // 0:24 to 2:29, because register is duration and a Short is always shortest.
  const testCuration = {
    topics: [{ id: 'insulin', aliases: ['insulin'] }],
    trusted_hosts: [],
    creators: [{ id: 'a', name: 'A', handle: '@a', channel_id: 'UC1', uploads_playlist_id: 'UU1', topics: ['insulin'] }],
  };
  const client = stubClient({
    uploads: { UU1: ['short', 'clip', 'real'] },
    videos: [
      { id: 'short', title: 'Insulin explained', description: '', published_at: monthsAgo(1), duration_iso: 'PT33S', views: 900_000, lang: 'en' },
      { id: 'clip', title: 'Insulin in two minutes', description: '', published_at: monthsAgo(1), duration_iso: 'PT2M29S', views: 500_000, lang: 'en' },
      { id: 'real', title: 'Insulin resistance explained', description: '', published_at: monthsAgo(1), duration_iso: 'PT12M', views: 1000, lang: 'en' },
    ],
  });

  const { grid, meta } = await runScan({ curation: testCuration, client, now: NOW });
  const ids = [...grid.values()].flat().map((e) => e.id);

  // The 900k-view Short would have topped the box on score alone.
  assert.deepEqual([...new Set(ids)], ['real']);
  assert.equal(meta.min_duration_seconds, 180);
});

test('an entry already stored from an earlier scan is dropped too', async () => {
  const testCuration = {
    topics: [{ id: 'insulin', aliases: ['insulin'] }],
    trusted_hosts: [],
    creators: [{ id: 'a', name: 'A', handle: '@a', channel_id: 'UC1', uploads_playlist_id: 'UU1', topics: ['insulin'] }],
  };
  const existing = new Map([
    ['a', [
      { id: 'legacy-short', topic: 'insulin', creator: 'A', creator_id: 'a', duration_seconds: 40, views: 999_999, published_at: monthsAgo(2) },
      { id: 'legacy-real', topic: 'insulin', creator: 'A', creator_id: 'a', duration_seconds: 900, views: 100, published_at: monthsAgo(2) },
    ]],
  ]);
  const { grid, meta } = await runScan({
    curation: testCuration,
    client: stubClient({ uploads: {}, videos: [] }),
    existing,
    now: NOW,
    only: [],
  });

  assert.deepEqual([...new Set([...grid.values()].flat().map((e) => e.id))], ['legacy-real']);
  assert.equal(meta.dropped_too_short, 1);
});

test('the top of a box rotates creators instead of stacking one', () => {
  // Berry outscores everyone three times over; the box must still open with
  // three different people, because the model routes from the top.
  const entries = [
    ...[9000, 8000, 7000].map((v, i) => ({ id: `berry${i}`, creator_id: 'berry', register: 'start', views: v, published_at: monthsAgo(1) })),
    ...[600, 500, 400].map((v, i) => ({ id: `mason${i}`, creator_id: 'mason', register: 'start', views: v, published_at: monthsAgo(1) })),
    ...[300, 200, 100].map((v, i) => ({ id: `cho${i}`, creator_id: 'cho', register: 'start', views: v, published_at: monthsAgo(1) })),
  ];
  const { start } = buildBoxes({ entries, topic: 'insulin', now: NOW });

  assert.deepEqual(start.slice(0, 3).map((e) => e.creator_id), ['berry', 'mason', 'cho']);
  // Within one creator, score still decides the order.
  assert.deepEqual(start.filter((e) => e.creator_id === 'berry').map((e) => e.id), ['berry0', 'berry1', 'berry2']);
});

test('a topic that empties out is overwritten, not left behind', async () => {
  // Found on the preview: the duration floor emptied seed-oils, the scan only
  // wrote topics that had entries, and the previous box — six Shorts — stayed
  // in KV looking current.
  const testCuration = {
    topics: [{ id: 'insulin', aliases: ['insulin'] }, { id: 'seed-oils', aliases: ['seed oils'] }],
    trusted_hosts: [],
    creators: [{ id: 'a', name: 'A', handle: '@a', channel_id: 'UC1', uploads_playlist_id: 'UU1', topics: ['insulin', 'seed-oils'] }],
  };
  const client = stubClient({
    uploads: { UU1: ['ok'] },
    videos: [{ id: 'ok', title: 'Insulin explained', description: '', published_at: monthsAgo(1), duration_iso: 'PT10M', views: 100, lang: 'en' }],
  });

  const { grid } = await runScan({ curation: testCuration, client, now: NOW });

  assert.ok(grid.has(gridKey('seed-oils', 'start')), 'the empty topic still gets a key');
  assert.deepEqual(grid.get(gridKey('seed-oils', 'start')), []);
  assert.equal(grid.get(gridKey('insulin', 'start')).length, 1);
});
