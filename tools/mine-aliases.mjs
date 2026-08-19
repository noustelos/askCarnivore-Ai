#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Propose topic aliases FROM THE ACTUAL TITLES, instead of guessing.

     node tools/mine-aliases.mjs           # uses .cache/titles.json if present
     node tools/mine-aliases.mjs --fetch   # (re)fetch titles, ~12 quota units
                                           # per creator, then cache them

   The 19/08 dry run showed the matcher missing three of Nick's own six
   getting-started videos: the alias list was written from how we talk about
   the topics, not from how creators title their videos. This reads the corpus
   and reports which short phrases actually recur.

   METHOD — and why the obvious one does not work.

   First attempt: take every unmatched title from creators who declare topic T
   and count recurring phrases. It produced "favorite", "super", "monday",
   "dave mac". Of course it did: a creator declares five topics and most of
   their catalogue is about none of them, so that counts a channel's general
   vocabulary, not a topic's.

   What works instead is asking a narrower question. We already know the CONCEPT
   of each topic — what we are missing is the SURFACE FORMS creators type. So:

     · derive a root from each existing alias ("electrolytes" → "electrolyt",
       "beginner" → "beginn")
     · find unmatched titles containing that root
     · report the 1-3 word window around it

   Every candidate is on-topic by construction, because it contains the topic's
   own root. The output is a list of phrasings we failed to anticipate, which
   is exactly the gap the dry run exposed.
   Nothing here writes to curation.json. It prints proposals for a human.
   --------------------------------------------------------------------------- */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createClient } from '../src/scan/youtube.js';
import { buildAliasIndex, matchTopics, normalize } from '../src/scan/match.js';

const CURATION = new URL('../src/curation.json', import.meta.url);
const CACHE_DIR = new URL('../.cache/', import.meta.url);
const CACHE = new URL('../.cache/titles.json', import.meta.url);

const curation = JSON.parse(readFileSync(CURATION, 'utf8'));
const aliasIndex = buildAliasIndex(curation.topics);

function loadKey() {
  if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY;
  const devVars = new URL('../.dev.vars', import.meta.url);
  const match = /^YOUTUBE_API_KEY\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(devVars, 'utf8'));
  if (!match) throw new Error('no YOUTUBE_API_KEY');
  return match[1].trim();
}

async function fetchTitles() {
  const client = createClient(loadKey());
  const out = {};
  for (const creator of curation.creators) {
    const ids = await client.listUploads(creator.uploads_playlist_id, { maxVideos: 300 });
    const videos = await client.listVideos(ids);
    out[creator.id] = videos.map((v) => v.title);
    console.error(`  ${creator.id}: ${videos.length} titles`);
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE, JSON.stringify(out));
  console.error(`\n${client.unitsUsed} quota units used, cached to .cache/titles.json\n`);
  return out;
}

const titles = process.argv.includes('--fetch') || !existsSync(CACHE)
  ? await fetchTitles()
  : JSON.parse(readFileSync(CACHE, 'utf8'));

/* Words that carry no topic, used only to trim the edges of a window. */
const STOP = new Set(`the a an and or of for to in on my your our is are was be do does how what why when
who which this that these those with without you i we they it its from at as by not no yes new best top
video watch subscribe channel part ep episode full more about into over under can will just get got go
going make made take taken like really very much most every all any some he she his her him them`.split(/\s+/));

/** "electrolytes" → "electrolyt". Long enough to stay on-topic, short enough to
    catch a different ending. Words under 5 letters get no root: "ldl" and "gut"
    are already exact. */
function rootOf(word) {
  return word.length >= 6 ? word.slice(0, word.length - 2) : word.length >= 5 ? word : null;
}

const missesByCreator = {};
for (const creator of curation.creators) {
  missesByCreator[creator.id] = (titles[creator.id] ?? []).filter(
    (title) => matchTopics({ title }, creator.topics, aliasIndex).length === 0,
  );
}

const existing = new Set([...aliasIndex.values()].flat());

console.log(
  `Titles scanned: ${Object.values(titles).flat().length} · unmatched today: ${Object.values(missesByCreator).flat().length}\n`,
);

for (const topic of curation.topics) {
  const creators = curation.creators.filter((c) => c.topics.includes(topic.id));

  // Roots of everything this topic already knows how to say.
  const roots = new Set();
  for (const alias of [topic.id.replace(/-/g, ' '), ...(topic.aliases ?? [])]) {
    for (const word of normalize(alias).split(' ')) {
      const root = rootOf(word);
      if (root) roots.add(root);
    }
  }

  const count = new Map();
  const byCreator = new Map();

  for (const creator of creators) {
    for (const title of missesByCreator[creator.id]) {
      const words = normalize(title).split(' ').filter(Boolean);
      const seen = new Set();

      words.forEach((word, i) => {
        if (![...roots].some((root) => word.startsWith(root))) return;
        // Windows of 1-3 words that include the hit, trimmed of stopword edges.
        for (let start = Math.max(0, i - 2); start <= i; start += 1) {
          for (let end = i + 1; end <= Math.min(words.length, i + 3); end += 1) {
            const gram = words.slice(start, end);
            if (gram.length > 3) continue;
            while (gram.length > 1 && STOP.has(gram[0])) gram.shift();
            while (gram.length > 1 && STOP.has(gram.at(-1))) gram.pop();
            const phrase = gram.join(' ');
            if (!phrase || existing.has(phrase) || seen.has(phrase)) continue;
            seen.add(phrase);
          }
        }
      });

      for (const phrase of seen) {
        count.set(phrase, (count.get(phrase) ?? 0) + 1);
        if (!byCreator.has(phrase)) byCreator.set(phrase, new Set());
        byCreator.get(phrase).add(creator.id);
      }
    }
  }

  const proposals = [...count.entries()]
    .filter(([phrase, n]) => n >= 3 && byCreator.get(phrase).size >= 2)
    .map(([phrase, n]) => ({ phrase, n, creators: byCreator.get(phrase).size }))
    .sort((a, b) => b.creators - a.creators || b.n - a.n)
    .slice(0, 8);

  console.log(`── ${topic.id}`);
  if (!proposals.length) console.log('   (no recurring phrasing we are missing)');
  for (const p of proposals) {
    console.log(`   ${p.phrase.padEnd(30)} ${String(p.n).padStart(4)}×  ${p.creators} creators`);
  }
  console.log();
}
