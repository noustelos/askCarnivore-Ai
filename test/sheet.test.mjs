/* ---------------------------------------------------------------------------
   Run with:  node --test test/sheet.test.mjs

   The sheet is the one input a person edits by hand while the bot is live, so
   these cover what a hand does: reordering columns, half-filling a row, pasting
   a channel link instead of a video link, and switching a line off instead of
   deleting it. Each case is written as the mistake, not as the mechanism.
   --------------------------------------------------------------------------- */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseSheet, applyOverride, videoIdFrom, versionOf } from '../src/sheet.js';

const HEADER = 'topic,creator,title,url,register,duration,lang,label,active';
const ROW = (o = {}) =>
  [
    o.topic ?? 'getting-started',
    o.creator ?? 'Dr. Ken Berry',
    o.title ?? 'A beginner guide',
    o.url ?? 'https://www.youtube.com/watch?v=e56gVwMFVPw',
    o.register ?? 'start',
    o.duration ?? '22:23',
    o.lang ?? 'en',
    o.label ?? '',
    o.active ?? 'yes',
  ].join(',');

test('quoted commas inside a title do not split the row', () => {
  const rows = parseCsv('a,b\n"one, two",three');
  assert.deepEqual(rows, [['a', 'b'], ['one, two', 'three']]);
});

test('escaped quotes survive', () => {
  assert.deepEqual(parseCsv('a\n"He said ""no"""'), [['a'], ['He said "no"']]);
});

test('columns are found by name, so the sheet can be reordered', () => {
  const reordered = 'active,url,register,topic,title\nyes,https://www.youtube.com/watch?v=e56gVwMFVPw,deep,cholesterol,Something';
  const { byTopic } = parseSheet(reordered);
  assert.equal(byTopic.get('cholesterol').deep[0].title, 'Something');
});

test('a row that is not active=yes is ignored', () => {
  const csv = [HEADER, ROW({ active: 'no' }), ROW({ active: '' }), ROW({ title: 'Kept', active: 'YES' })].join('\n');
  const { byTopic, rows } = parseSheet(csv);
  assert.equal(rows, 1);
  assert.equal(byTopic.get('getting-started').start[0].title, 'Kept');
});

test('a channel link is not a video link, and the row is dropped loudly', () => {
  // The exact mistake that reached the seed sheet once already.
  const csv = [HEADER, ROW({ url: 'https://www.youtube.com/@NutritionwithJudy' })].join('\n');
  const { byTopic, rows, notes } = parseSheet(csv);
  assert.equal(rows, 0);
  assert.equal(byTopic.size, 0);
  assert.ok(notes.some((n) => n.startsWith('bad-url')));
});

test('the link is rebuilt from the id, never taken as pasted', () => {
  const csv = [HEADER, ROW({ url: 'https://www.youtube.com/watch?v=e56gVwMFVPw&list=PLjunk&index=17' })].join('\n');
  const { byTopic } = parseSheet(csv);
  assert.equal(byTopic.get('getting-started').start[0].url, 'https://www.youtube.com/watch?v=e56gVwMFVPw');
});

test('an unusable register is refused rather than guessed', () => {
  const csv = [HEADER, ROW({ register: 'intro' })].join('\n');
  const { rows, notes } = parseSheet(csv);
  assert.equal(rows, 0);
  assert.ok(notes.some((n) => n.includes('bad-register')));
});

test('an empty label stays null so the model writes it under §8', () => {
  const csv = [HEADER, ROW({ label: '' }), ROW({ url: 'https://youtu.be/idzfbxc_hAw', label: 'Judy Cho — five tips' })].join('\n');
  const { byTopic } = parseSheet(csv);
  const [first, second] = byTopic.get('getting-started').start;
  assert.equal(first.label, null);
  assert.equal(second.label, 'Judy Cho — five tips');
});

test('a topic listed with one register mirrors into the other (§14.16)', () => {
  // Otherwise "Go deeper" would come back empty, which the bot must never say.
  const csv = [HEADER, ROW({ register: 'start' }), ROW({ url: 'https://youtu.be/idzfbxc_hAw', register: 'start' })].join('\n');
  const { byTopic } = parseSheet(csv);
  const box = byTopic.get('getting-started');
  assert.equal(box.start.length, 2);
  assert.deepEqual(box.deep.map((e) => e.id), box.start.map((e) => e.id));
  assert.ok(box.deep.every((e) => e.register === 'deep'));
});

test('an unknown topic is flagged but still served — the sheet is the owner', () => {
  const csv = [HEADER, ROW({ topic: 'gout' })].join('\n');
  const { byTopic, notes } = parseSheet(csv, { knownTopics: new Set(['getting-started']) });
  assert.ok(byTopic.has('gout'));
  assert.ok(notes.some((n) => n === 'unknown-topic:gout'));
});

test('control characters in a title never reach the prompt', () => {
  const { byTopic } = parseSheet([HEADER, ROW({ title: '"Line one\nLine two"' })].join('\n'));
  assert.equal(byTopic.get('getting-started').start[0].title, 'Line one Line two');
});

/* ---- the override itself -------------------------------------------------- */

const grid = [
  { id: 'g1', topic: 'getting-started', creator: 'Laura Spath', register: 'start' },
  { id: 'g2', topic: 'getting-started', creator: 'Laura Spath', register: 'deep' },
  { id: 'g3', topic: 'cholesterol', creator: 'Nick Norwitz', register: 'start' },
];

test('a topic in the sheet replaces its grid entries completely', () => {
  const { byTopic } = parseSheet([HEADER, ROW()].join('\n'));
  const { videos, overriddenTopics } = applyOverride({ gridVideos: grid, override: { byTopic } });

  assert.deepEqual(overriddenTopics, ['getting-started']);
  assert.equal(videos.filter((v) => v.topic === 'getting-started' && v.id.startsWith('g')).length, 0);
  // A topic the sheet does not mention is untouched.
  assert.deepEqual(videos.filter((v) => v.topic === 'cholesterol').map((v) => v.id), ['g3']);
});

test('no sheet, or an empty one, leaves the grid exactly as it was', () => {
  assert.deepEqual(applyOverride({ gridVideos: grid, override: null }).videos, grid);
  assert.deepEqual(applyOverride({ gridVideos: grid, override: { byTopic: new Map() } }).videos, grid);
});

test('the sheet keeps the order it was written in', () => {
  const csv = [
    HEADER,
    ROW({ title: 'Third', url: 'https://www.youtube.com/watch?v=SgDiSbiQv9A' }),
    ROW({ title: 'First', url: 'https://www.youtube.com/watch?v=e56gVwMFVPw' }),
  ].join('\n');
  const { byTopic } = parseSheet(csv);
  assert.deepEqual(byTopic.get('getting-started').start.map((e) => e.title), ['Third', 'First']);
});

test('the version changes when the content does, and only then', () => {
  const a = [HEADER, ROW()].join('\n');
  assert.equal(versionOf(a), versionOf(`${a}`));
  assert.notEqual(versionOf(a), versionOf([HEADER, ROW({ title: 'Different' })].join('\n')));
});

test('video ids come out of the shapes a person actually pastes', () => {
  assert.equal(videoIdFrom('https://www.youtube.com/watch?v=e56gVwMFVPw'), 'e56gVwMFVPw');
  assert.equal(videoIdFrom('https://youtu.be/e56gVwMFVPw?t=30'), 'e56gVwMFVPw');
  assert.equal(videoIdFrom('https://www.youtube.com/watch?v=e56gVwMFVPw&list=PLx&index=2'), 'e56gVwMFVPw');
  assert.equal(videoIdFrom('https://www.youtube.com/@SomeChannel'), null);
  assert.equal(videoIdFrom('https://example.com/watch?v=e56gVwMFVPw'), 'e56gVwMFVPw');
});
