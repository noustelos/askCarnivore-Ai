/* ---------------------------------------------------------------------------
   Run with:  node --test test/blog.test.mjs

   Two jobs, and the second is the reason this file exists at all.

   1. The sheet is edited by hand while the site is live, so the parse cases are
      written as the mistake a hand makes: a row that predates the feature, a
      date typo, a channel link pasted where a video link belongs.

   2. `/new` is served by a Pages Function, and Cloudflare does NOT apply
      `_headers` to Function responses. Every other page here gets its CSP from
      that file; this one carries its own in code. If someone deletes those
      headers, nothing breaks visibly — the portal's frame keeps working and so
      does everyone else's, because a missing frame-ancestors means "anyone".
      The header tests below are the only thing that would notice.
   --------------------------------------------------------------------------- */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWhatsNew,
  sortWhatsNew,
  isoDate,
  topicPill,
  escapeHtml,
  renderPage,
  securityHeaders,
} from '../src/blog.js';

const HEADER = 'topic,creator,title,url,register,duration,lang,label,active,blog,date,format,pin';
const URL_A = 'https://www.youtube.com/watch?v=e56gVwMFVPw';
const URL_B = 'https://youtu.be/dQw4w9WgXcQ';

const ROW = (o = {}) =>
  [
    o.topic ?? 'cholesterol',
    o.creator ?? 'Dr. Ken Berry',
    o.title ?? 'A beginner guide',
    o.url ?? URL_A,
    o.register ?? 'start',
    o.duration ?? '22:23',
    o.lang ?? 'en',
    o.label ?? '',
    o.active ?? 'yes',
    o.blog ?? 'yes',
    o.date ?? '2026-08-20',
    o.format ?? 'interview',
    o.pin ?? '',
  ].join(',');

const csv = (...rows) => [HEADER, ...rows].join('\n');

/* ---------- the switch ---------- */

test('a row that predates the feature has no blog cell, so it stays off the page', () => {
  const old = 'topic,creator,title,url,register,duration,lang,label,active\n' +
    `cholesterol,Dr. Ken Berry,Old row,${URL_A},start,22:23,en,,yes`;
  const { items, notes } = parseWhatsNew(old);
  assert.equal(items.length, 0);
  assert.ok(notes.includes('missing-columns:blog'));
});

test('blog=yes is the only switch — active=no still shows on the page', () => {
  const { items } = parseWhatsNew(csv(ROW({ active: 'no', blog: 'yes' })));
  assert.equal(items.length, 1);
});

test('active=yes with no blog cell filled does not show', () => {
  const { items } = parseWhatsNew(csv(ROW({ active: 'yes', blog: '' })));
  assert.equal(items.length, 0);
});

test('columns are found by name, so the sheet can be reordered', () => {
  const reordered = `blog,url,title,date\nyes,${URL_A},Something,2026-01-02`;
  const { items } = parseWhatsNew(reordered);
  assert.equal(items[0].title, 'Something');
  assert.equal(items[0].date, '2026-01-02');
});

/* ---------- what a hand gets wrong ---------- */

test('a channel link instead of a video link drops the row and says so', () => {
  const { items, notes } = parseWhatsNew(csv(ROW({ url: 'https://www.youtube.com/@DrKenBerry' })));
  assert.equal(items.length, 0);
  assert.ok(notes.some((n) => n.startsWith('bad-url:')));
});

test('a date typo keeps the row and reports it — a typo must not delete a choice', () => {
  const { items, notes } = parseWhatsNew(csv(ROW({ date: '20-08-2026' })));
  assert.equal(items.length, 1);
  assert.equal(items[0].date, null);
  assert.ok(notes.some((n) => n.startsWith('bad-date:')));
});

test('an impossible calendar date is not a date', () => {
  assert.equal(isoDate('2026-13-40'), null);
  assert.equal(isoDate('2026-02-30'), null);
  assert.equal(isoDate('2026-08-30'), '2026-08-30');
});

test('the link is rebuilt from the id, never taken from the sheet', () => {
  const { items } = parseWhatsNew(csv(ROW({ url: `${URL_A}&utm_source=evil` })));
  assert.equal(items[0].url, 'https://www.youtube.com/watch?v=e56gVwMFVPw');
});

/* ---------- order ---------- */

test('pinned first, then newest, undated last', () => {
  const { items } = parseWhatsNew(csv(
    ROW({ title: 'older', date: '2026-01-01' }),
    ROW({ title: 'undated', date: '', url: URL_B }),
    ROW({ title: 'newest', date: '2026-08-29' }),
    ROW({ title: 'pinned old', date: '2020-01-01', pin: 'yes' }),
  ));
  assert.deepEqual(items.map((i) => i.title), ['pinned old', 'newest', 'older', 'undated']);
});

test('pinning several keeps them in date order among themselves', () => {
  const items = sortWhatsNew([
    { title: 'pin old', date: '2026-01-01', pinned: true },
    { title: 'pin new', date: '2026-08-01', pinned: true },
    { title: 'loose', date: '2026-09-01', pinned: false },
  ]);
  assert.deepEqual(items.map((i) => i.title), ['pin new', 'pin old', 'loose']);
});

/* ---------- the two pills are two different claims ---------- */

test('the topic pill takes the English half of a bilingual label', () => {
  const topics = [{ id: 'cholesterol', label: 'Cholesterol / χοληστερίνη' }];
  assert.equal(topicPill('cholesterol', topics), 'Cholesterol');
});

test('an unknown topic has no pill rather than a raw id', () => {
  assert.equal(topicPill('not-a-topic', [{ id: 'cholesterol', label: 'Cholesterol' }]), null);
});

test('an empty format cell means no second pill, not an empty one', () => {
  const { items } = parseWhatsNew(csv(ROW({ format: '' })));
  const html = renderPage({ items, topics: [{ id: 'cholesterol', label: 'Cholesterol / χοληστερίνη' }] });
  // The class names both live in the inline stylesheet, so the assertion has to
  // look for a rendered pill, not for the word anywhere on the page.
  assert.ok(html.includes('<span class="pill pill--topic">'));
  assert.ok(!html.includes('<span class="pill pill--format">'));
});

/* ---------- the sheet is an input like any other ---------- */

test('a title from the sheet cannot open a tag', () => {
  assert.equal(escapeHtml('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
});

test('a pasted title with markup reaches the page escaped', () => {
  const { items } = parseWhatsNew(csv(ROW({ title: '"<img src=x onerror=alert(1)>"' })));
  const html = renderPage({ items, topics: [] });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
});

/* ---------- the headers _headers cannot give this route ---------- */

test('the response carries a CSP, because _headers does not reach a Function', () => {
  const csp = securityHeaders()['content-security-policy'];
  assert.ok(csp, 'no CSP at all on /new');
  assert.ok(csp.includes("default-src 'self'"));
});

test('askcarnivores.com may frame /new, and the policy is not "anyone"', () => {
  const csp = securityHeaders()['content-security-policy'];
  assert.match(csp, /frame-ancestors [^;]*https:\/\/askcarnivores\.com/);
  assert.match(csp, /frame-ancestors [^;]*https:\/\/www\.askcarnivores\.com/);
  assert.ok(!/frame-ancestors[^;]*\*/.test(csp), 'frame-ancestors must not be a wildcard');
});

test('/new carries the headers the /* block gives every other page', () => {
  const headers = securityHeaders();
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.ok(headers['permissions-policy'].includes('camera=()'));
});

test('the page declares no script-src, because it ships no script', () => {
  const csp = securityHeaders()['content-security-policy'];
  assert.ok(!csp.includes('script-src'));
  assert.ok(!renderPage({ items: [], topics: [] }).includes('<script'));
});

/* ---------- an empty page is a sentence, not a blank ---------- */

test('no rows renders a line rather than an empty list', () => {
  const html = renderPage({ items: [], topics: [] });
  assert.ok(html.includes('Nothing here yet'));
  assert.ok(!html.includes('<ul class="cards">'));
});
