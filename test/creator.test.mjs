/* Creator-scoped queries. The cells below are COPIED FROM THE LIVE SHEET
   (04/09/2026), not invented: the awkward ones — a surname with no first name,
   "Dr." with no space after it, two separators in one cell, a trailing space —
   are what the real data looks like, and they are the whole reason this
   module is not a substring test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName,
  nameTokens,
  splitCreators,
  isSamePerson,
  creditsCreator,
  filterByCreator,
} from '../src/creator.js';
import curation from '../src/curation.json' with { type: 'json' };

test('titles come off, names do not', () => {
  assert.deepEqual(nameTokens('Dr. Ken Berry'), ['ken', 'berry']);
  assert.deepEqual(nameTokens('Dr.Shawn Baker'), ['shawn', 'baker']); // no space
  assert.deepEqual(nameTokens('Dr Paul Mason'), ['paul', 'mason']); // no period
  assert.deepEqual(nameTokens('Professor Bart Kay'), ['bart', 'kay']);
});

test('"Coach" is part of the name, not a title (decision 04/09/2026)', () => {
  assert.deepEqual(nameTokens('Coach Stephen'), ['coach', 'stephen']);
  // The reason: stripping it would leave this one as "Carnivore Cam", nobody.
  assert.deepEqual(nameTokens('Coach Carnivore Cam'), ['coach', 'carnivore', 'cam']);
  assert.equal(isSamePerson('Coach Stephen', 'Coach Carnivore Cam'), false);
});

test('an apostrophe stays inside the surname', () => {
  assert.deepEqual(nameTokens("Amber O'Hearn"), ["amber", "o'hearn"]);
  assert.equal(nameTokens("Amber O'Hearn").length, 2);
});

test('trailing spaces survive nothing, including inside compounds', () => {
  assert.equal(normalizeName('Dr. Georgia Ede '), 'dr georgia ede');
  assert.deepEqual(nameTokens('Dr. Georgia Ede '), ['georgia', 'ede']);
  assert.deepEqual(splitCreators('Dr. Georgia Ede, Dr.Shawn Baker '), [
    'Dr. Georgia Ede',
    'Dr.Shawn Baker',
  ]);
});

test('a cell is split on every separator the sheet actually uses', () => {
  assert.deepEqual(splitCreators('Dr Paul Mason & Dr Chaffee'), ['Dr Paul Mason', 'Dr Chaffee']);
  assert.deepEqual(splitCreators('Kelly Hogan, Laura Spath & Brandon Crouch'), [
    'Kelly Hogan',
    'Laura Spath',
    'Brandon Crouch',
  ]);
  assert.deepEqual(splitCreators('Dr. Ken Berry, Ben Bikman'), ['Dr. Ken Berry', 'Ben Bikman']);
});

test('surname alone matches a full name — the case "contains" cannot do', () => {
  // The live sheet credits "Dr Chaffee"; the roster says "Dr. Anthony Chaffee".
  // Neither string contains the other.
  assert.ok(isSamePerson('Dr Chaffee', 'Anthony Chaffee'));
  assert.ok(isSamePerson('Anthony Chaffee', 'Chaffee'));
  assert.ok(isSamePerson('Dr. Ken Berry', 'Berry'));
});

test('two first names on the same surname must agree; two Roberts do not merge', () => {
  assert.equal(isSamePerson('Dr. Robert Kiltz', 'Robert Lustig'), false);
  assert.equal(isSamePerson('Ken Berry', 'Ben Bikman'), false);
  assert.equal(isSamePerson('Dr. Ken Berry', 'Bart Kay'), false);
});

test('an interview counts for every name on it', () => {
  const cell = 'Dr. Ken Berry, Ben Bikman';
  assert.ok(creditsCreator(cell, 'Berry'));
  assert.ok(creditsCreator(cell, 'Bikman'));
  assert.ok(creditsCreator(cell, 'Dr. Ben Bikman'));
  assert.equal(creditsCreator(cell, 'Paul Mason'), false);
});

test('a three-person cell answers for the guest who is not on the roster', () => {
  const cell = 'Kelly Hogan, Laura Spath & Brandon Crouch';
  assert.ok(creditsCreator(cell, 'Brandon Crouch'));
  assert.ok(creditsCreator(cell, 'Laura Spath'));
});

test('an empty name never matches — it must not select everything', () => {
  assert.equal(creditsCreator('Dr. Ken Berry', ''), false);
  assert.equal(creditsCreator('Dr. Ken Berry', '   '), false);
  assert.equal(creditsCreator('Dr. Ken Berry', null), false);
});

test('the filter takes sheet rows only, never the scan grid', () => {
  const links = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const byId = new Map([
    ['a', { creator: 'Dr. Ken Berry', source: 'sheet' }],
    ['b', { creator: 'Dr. Ken Berry', source: 'own' }], // same person, from the scan
    ['c', { creator: 'Ben Bikman', source: 'sheet' }],
  ]);
  assert.deepEqual(filterByCreator(links, 'Berry', byId).map((l) => l.id), ['a']);
});

test('a miss returns empty, never the unfiltered list', () => {
  const links = [{ id: 'a' }];
  const byId = new Map([['a', { creator: 'Dr. Ken Berry', source: 'sheet' }]]);
  assert.deepEqual(filterByCreator(links, 'Paul Mason', byId), []);
});

/* ⚠ THE GUARD. The surname anchor is only safe while surnames are unique
   across the roster, which they are today (27 names, zero collisions). The
   list is closed at 27 (§17), so this should never fire — but if it ever
   opens, a colliding surname would make "by X" quietly serve the wrong
   person, and silence is the worst failure mode this feature has. */
test('roster surnames are unique — the surname anchor depends on it', () => {
  const everyone = [...(curation.creators ?? []), ...(curation.excluded_from_scan ?? [])];
  assert.ok(everyone.length >= 27, 'roster should hold the full 27');

  const bySurname = new Map();
  for (const person of everyone) {
    const tokens = nameTokens(person.name);
    const surname = tokens[tokens.length - 1];
    bySurname.set(surname, [...(bySurname.get(surname) ?? []), person.name]);
  }

  const collisions = [...bySurname.entries()].filter(([, names]) => names.length > 1);
  assert.deepEqual(
    collisions,
    [],
    `colliding surnames would silently serve the wrong person: ${JSON.stringify(collisions)}`,
  );
});
