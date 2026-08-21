#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Resolve every handle in src/curation.json to a channel id, ONCE.

     node tools/resolve-channels.mjs          # report only, writes nothing
     node tools/resolve-channels.mjs --write  # writes the ids into curation.json

   Reads YOUTUBE_API_KEY from the environment or from .dev.vars (gitignored).

   Why this is a one-off script and not part of the cron:
   a channel id never changes. Resolving costs 1 unit per creator and the
   answer is permanent, so it is resolved once, committed to git, and read for
   free forever after. The cron only ever reads `channel_id` and
   `uploads_playlist_id` out of the file.

   Why `forHandle` and not `search.list`: exactness. search.list costs 100 units
   and returns *likely* channels — "Richard Smith" or "Kelly Hogan" would come
   back with several plausible answers and no way for a script to pick. A handle
   is the channel. Every handle in curation.json was copied by hand from the
   portal's verified directory links.

   The script never silently accepts a surprise: if the title YouTube returns
   does not resemble the name we expect, it flags the row and (with --write)
   leaves that channel_id null rather than guessing.
   --------------------------------------------------------------------------- */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createClient } from '../src/scan/youtube.js';
import { normalize } from '../src/scan/match.js';

const CURATION = new URL('../src/curation.json', import.meta.url);

function loadKey() {
  if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY;
  const devVars = new URL('../.dev.vars', import.meta.url);
  if (existsSync(devVars)) {
    const match = /^YOUTUBE_API_KEY\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(devVars, 'utf8'));
    if (match) return match[1].trim();
  }
  console.error('No YOUTUBE_API_KEY. Put it in .dev.vars (gitignored) or the environment.');
  process.exit(1);
}

/** Does the channel title YouTube returned plausibly belong to this creator?
    Loose on purpose — "Nutrition with Judy" is Judy Cho's channel — but it
    still catches the failure that matters: a handle pointing at a stranger. */
function looksRight(expectedName, expectedChannel, actualTitle) {
  const actual = normalize(actualTitle);
  const words = new Set([...normalize(expectedName).split(' '), ...normalize(expectedChannel).split(' ')]);
  for (const word of words) {
    if (word.length >= 4 && actual.includes(word)) return true;
  }
  return false;
}

const curation = JSON.parse(readFileSync(CURATION, 'utf8'));
const client = createClient(loadKey());
const write = process.argv.includes('--write');

const targets = [
  ...curation.creators.map((c) => ({ kind: 'creator', ref: c, name: c.name, channel: c.channel })),
  ...(curation.trusted_hosts ?? []).map((h) => ({
    kind: 'trusted_host',
    ref: h,
    name: h.handle,
    channel: h.handle,
  })),
];

const rows = [];
for (const target of targets) {
  const handle = target.ref.handle;
  let resolved = null;
  let error = null;
  try {
    resolved = await client.resolveHandle(handle);
  } catch (e) {
    error = String(e).slice(0, 120);
  }

  const ok = Boolean(resolved) && looksRight(target.name, target.channel, resolved.title);
  rows.push({ target, handle, resolved, error, ok });

  if (write && resolved && ok) {
    target.ref.channel_id = resolved.channel_id;
    target.ref.uploads_playlist_id = resolved.uploads_playlist_id;
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(
  `\n${pad('creator', 24)}${pad('handle', 26)}${pad('channel YouTube returned', 32)}${pad('channel_id', 26)}check`,
);
console.log('-'.repeat(116));
for (const { target, handle, resolved, error, ok } of rows) {
  console.log(
    pad(target.name, 24) +
      pad(handle, 26) +
      pad(resolved?.title ?? `— ${error ?? 'not found'}`, 32) +
      pad(resolved?.channel_id ?? '—', 26) +
      (resolved ? (ok ? 'ok' : '⚠ NAME MISMATCH — check by eye') : '⚠ UNRESOLVED'),
  );
}

const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length}/${rows.length} resolved · ${client.unitsUsed} quota units used`);
if (bad.length) console.log(`${bad.length} need a human decision — nothing was written for those.`);

if (write) {
  writeFileSync(CURATION, `${JSON.stringify(curation, null, 2)}\n`);
  console.log('\ncuration.json updated. Review the diff before committing.');
} else {
  console.log('\nReport only. Re-run with --write once the table above looks right.');
}
