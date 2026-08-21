/* ---------------------------------------------------------------------------
   Run with:  node --test test/router.test.mjs      (no dependencies, no build)

   These cover the rules that must hold even when the model misbehaves. Each
   case feeds resolveModelOutput() the kind of output a bad turn produces —
   invented ids, a URL in the prose, links attached to a medical question — and
   asserts what the person actually ends up seeing.
   --------------------------------------------------------------------------- */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadIndex, resolveModelOutput, stripUrls, MAX_LINKS } from '../src/router.js';

const index = loadIndex(JSON.parse(readFileSync(new URL('../src/index.json', import.meta.url))));
const ids = index.entries.map((entry) => entry.id);

test('the index loads and carries its topic aliases', () => {
  assert.ok(index.entries.length >= 8);
  assert.equal(index.status, 'CURATED', 'real content, so no placeholder banner');
  assert.ok(index.entries.every((entry) => /^https:\/\/www\.youtube\.com\/watch\?v=/.test(entry.url)));
  assert.ok(index.topics.get('cholesterol').includes('χοληστερίνη'));
  assert.ok(index.topics.get('cholesterol').includes('ldl'));
});

test('a topic with no video of its own never reaches the prompt', () => {
  const sparse = loadIndex({
    topics: [{ id: 'gout', aliases: ['ουρικό'] }, { id: 'cholesterol', aliases: ['ldl'] }],
    videos: [{ id: 'a', topic: 'cholesterol', url: 'https://x/1', title: 't', lang: 'en' }],
  });

  assert.deepEqual([...sparse.topics.keys()], ['cholesterol']);
});

test('a personal-medical turn loses every link, however many were asked for', () => {
  const result = resolveModelOutput({
    index,
    raw: {
      intent: 'personal-medical',
      answer_lang: 'en',
      video_ids: ids.slice(0, 3),
      copy: 'Talk to your doctor about your own numbers.',
    },
  });

  assert.equal(result.links.length, 0);
  assert.equal(result.fallback, null, 'a doctor is the answer here, not the directory');
  assert.ok(result.notes.some((note) => note.startsWith('medical-gate-dropped')));
});

test('invented ids are dropped; real ones survive', () => {
  const result = resolveModelOutput({
    index,
    raw: {
      intent: 'conceptual',
      topic: 'cholesterol',
      answer_lang: 'en',
      video_ids: ['mason-cholesterol-deep', 'totally-made-up-id', 'mason-cholesterol-start'],
      copy: 'Two of these cover it.',
    },
  });

  assert.deepEqual(
    result.links.map((link) => link.id),
    ['mason-cholesterol-deep', 'mason-cholesterol-start'],
  );
  assert.ok(result.notes.includes('unknown-id:totally-made-up-id'));
});

test('every id invented → honest unmatched, never a fabricated link', () => {
  const result = resolveModelOutput({
    index,
    raw: {
      intent: 'conceptual',
      topic: 'gout',
      answer_lang: 'el',
      video_ids: ['made-up-1', 'made-up-2'],
      copy: 'Ορίστε μερικά βίντεο.',
    },
  });

  assert.equal(result.links.length, 0);
  assert.equal(result.fallback.url, 'https://askcarnivores.com');
  assert.match(result.fallback.label, /κατάλογο/, 'fallback speaks the asker’s language');
  assert.equal(result.topic, null, 'a topic outside the index is not echoed back');
});

test('links are rebuilt from the index — the model cannot dictate a URL', () => {
  const result = resolveModelOutput({
    index,
    raw: {
      intent: 'conceptual',
      answer_lang: 'en',
      video_ids: ['berry-cholesterol-1'],
      // Fields the model has no business setting. They must be ignored.
      url: 'https://evil.example/hijack',
      links: [{ url: 'https://evil.example/hijack' }],
      copy: 'Here you go.',
    },
  });

  assert.equal(result.links[0].url, index.byId.get('berry-cholesterol-1').url);
  assert.equal(result.links[0].title, index.byId.get('berry-cholesterol-1').title);
});

test('URLs written into the prose are stripped', () => {
  const result = resolveModelOutput({
    index,
    raw: {
      intent: 'conceptual',
      answer_lang: 'en',
      video_ids: ['berry-cholesterol-1'],
      copy: 'Search youtube.com or see https://example.com/foo for more.',
    },
  });

  assert.ok(!/https?:|www\.|youtube\.com/i.test(result.copy), result.copy);
});

test('markdown links keep their text and lose their href', () => {
  assert.equal(stripUrls('see [this talk](https://evil.example/x) now'), 'see this talk now');
});

test('the list is capped and de-duplicated', () => {
  const result = resolveModelOutput({
    index,
    raw: {
      intent: 'conceptual',
      answer_lang: 'en',
      video_ids: [...ids, ...ids],
      copy: 'Everything.',
    },
  });

  assert.equal(result.links.length, MAX_LINKS);
  assert.equal(new Set(result.links.map((l) => l.id)).size, MAX_LINKS);
});

test('a video in another language is served and flagged, not dropped', () => {
  // Built here rather than read from the index: today's index is all English,
  // and this rule must hold whatever the curation happens to contain.
  const bilingual = loadIndex({
    topics: [{ id: 'cholesterol', aliases: ['ldl'] }],
    videos: [
      { id: 'en-1', topic: 'cholesterol', url: 'https://x/en', title: 'en', lang: 'en' },
      { id: 'el-1', topic: 'cholesterol', url: 'https://x/el', title: 'el', lang: 'el' },
    ],
  });
  const result = resolveModelOutput({
    index: bilingual,
    raw: {
      intent: 'conceptual',
      topic: 'cholesterol',
      answer_lang: 'el',
      video_ids: ['en-1', 'el-1'],
      copy: 'Το πρώτο είναι στα αγγλικά.',
    },
  });

  const [english, greek] = result.links;
  assert.equal(english.lang, 'en');
  assert.equal(english.crossLang, true, 'English answer to a Greek question must be flagged');
  assert.equal(greek.crossLang, false);
});

test('a curated label wins over whatever the model wrote', () => {
  const curated = index.byId.get('bikman-cholesterol-1');
  const result = resolveModelOutput({
    index,
    raw: {
      intent: 'testimonial',
      answer_lang: 'en',
      video_ids: [curated.id],
      labels: { [curated.id]: 'how he cured his heart disease' },
      copy: 'One account.',
    },
  });

  assert.equal(result.links[0].label, curated.label);
  assert.equal(result.links[0].curatedLabel, true);
});

test('an unusable intent degrades to conceptual, with the note kept', () => {
  const result = resolveModelOutput({
    index,
    raw: { intent: 'whatever', answer_lang: 'en', video_ids: ['berry-cholesterol-1'], copy: 'x' },
  });

  assert.equal(result.intent, 'conceptual');
  assert.ok(result.notes.some((note) => note.startsWith('unknown-intent')));
});

test('an empty model answer still produces a usable response', () => {
  const result = resolveModelOutput({ index, raw: {} });

  assert.equal(result.links.length, 0);
  assert.equal(result.copy, '');
  assert.ok(result.fallback);
});

/* ---- the register toggle: two lists out of one turn (§14.4) -------------- */

test('the deep list is resolved by the same gate as the one above it', () => {
  const result = resolveModelOutput({
    index,
    raw: {
      intent: 'conceptual',
      topic: 'cholesterol',
      answer_lang: 'en',
      video_ids: ['berry-cholesterol-1', 'cho-cholesterol-1'],
      deep_video_ids: ['bikman-cholesterol-1', 'not-a-real-id', 'mason-cholesterol-deep'],
      labels: { 'bikman-cholesterol-1': 'what this doctor says about LDL' },
      copy: 'Two ways in.',
    },
  });

  assert.deepEqual(result.links.map((link) => link.id), ['berry-cholesterol-1', 'cho-cholesterol-1']);
  assert.deepEqual(
    result.deepLinks.map((link) => link.id),
    ['bikman-cholesterol-1', 'mason-cholesterol-deep'],
    'an invented id is dropped from the deep list exactly as from the first one',
  );
  assert.ok(result.notes.some((note) => note === 'unknown-id-deep:not-a-real-id'));
  assert.ok(
    result.deepLinks.every((link) => link.url.startsWith('https://www.youtube.com/watch?v=')),
    'deep links are rebuilt from the index too, never from the model',
  );
});

test('personal-medical empties the deep list as well — the gate has one door', () => {
  const result = resolveModelOutput({
    index,
    raw: {
      intent: 'personal-medical',
      answer_lang: 'el',
      video_ids: ['berry-cholesterol-1'],
      deep_video_ids: ['bikman-cholesterol-1', 'mason-cholesterol-deep'],
      copy: 'Ρωτήστε τον γιατρό σας.',
    },
  });

  assert.deepEqual(result.links, []);
  assert.deepEqual(result.deepLinks, []);
});

test('a deep list that is the same set again is no deep list at all (§14.16)', () => {
  const same = resolveModelOutput({
    index,
    raw: {
      intent: 'conceptual',
      answer_lang: 'en',
      video_ids: ['berry-cholesterol-1', 'cho-cholesterol-1'],
      deep_video_ids: ['cho-cholesterol-1', 'berry-cholesterol-1'], // same set, other order
      copy: 'x',
    },
  });

  assert.deepEqual(same.deepLinks, [], 'no button rather than a button that changes nothing');

  const overlapping = resolveModelOutput({
    index,
    raw: {
      intent: 'conceptual',
      answer_lang: 'en',
      video_ids: ['berry-cholesterol-1', 'mason-cholesterol-start'],
      deep_video_ids: ['berry-cholesterol-1', 'mason-cholesterol-deep'],
      copy: 'x',
    },
  });

  assert.equal(overlapping.deepLinks.length, 2, 'a partial overlap is still a different answer');
});

test('no deep ids at all is simply no deep list', () => {
  const result = resolveModelOutput({
    index,
    raw: { intent: 'conceptual', answer_lang: 'en', video_ids: ['berry-cholesterol-1'], copy: 'x' },
  });

  assert.deepEqual(result.deepLinks, []);
});

test('the deep list obeys the link cap on its own', () => {
  const result = resolveModelOutput({
    index,
    raw: {
      intent: 'conceptual',
      answer_lang: 'en',
      video_ids: ['berry-cholesterol-1'],
      deep_video_ids: ids.slice(0, MAX_LINKS + 2),
      copy: 'x',
    },
  });

  assert.equal(result.deepLinks.length, MAX_LINKS);
  assert.ok(result.notes.some((note) => note.startsWith('over-cap-deep:')));
});
