// RL-03, RL-47 and RL-28's own contract on the word path: the typed string
// is looked up whole first (RL-03), a form that misses resolves through a
// lemma candidate with its suffix's part of speech pinned ahead of any
// frequency order (RL-47), and a correction is only ever computed on a true
// miss — never beside an exact hit, never beside an inflected one (RL-28's
// own comment in lookup.ts). Every index here is built through the real
// `buildIndex`, on invented headwords, never against the shipped
// dictionary: what is asserted is the module's own behaviour, not today's
// corpus.
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildIndex, type DictionaryIndex } from "./index-build";
import type { PartOfSpeech, RawEntry } from "./format";
import { hasEntry, lookupWord, suggest } from "./lookup";

function entry(
  headword: string,
  pos: PartOfSpeech,
  translations: readonly string[] = ["x"],
): RawEntry {
  return [headword, pos, null, translations, null];
}

function fakeIndex(entries: RawEntry[]): DictionaryIndex {
  return buildIndex({ version: 1, entries });
}

// --- RL-03: a multi-word entry answers whole, as a word ---

test("RL-03: a multi-word headword the dictionary carries answers as a word, spaces kept", () => {
  const index = fakeIndex([entry("zip zap", "v")]);
  const answer = lookupWord(index, "zip zap");
  assert.ok(answer.exact !== null);
  assert.equal(answer.exact?.headword, "zip zap");
});

// --- single-letter headwords: only "a" and "i" are ever answered ---

test('a one-letter query normalises and answers when it is "a", even though the index carries it', () => {
  const index = fakeIndex([entry("a", "pn"), entry("b", "n")]);
  const answer = lookupWord(index, "A");
  assert.ok(answer.exact !== null);
});

test('a one-letter query that is not "a" or "i" answers nothing at all, even though the index carries the letter as a headword', () => {
  const index = fakeIndex([entry("b", "n")]);
  const answer = lookupWord(index, "b");
  assert.deepEqual(answer, { query: "b", exact: null, viaInflection: [], correction: [] });
});

// --- correction (RL-28) only ever fires on a true miss ---

test("an exact hit never computes a correction, even when a one-edit headword exists", () => {
  const index = fakeIndex([entry("zorpz", "n"), entry("zorpx", "n")]);
  const answer = lookupWord(index, "zorpz");
  assert.ok(answer.exact !== null);
  assert.deepEqual(answer.correction, []);
});

test("an inflected hit never computes a correction, even when a one-edit headword exists", () => {
  // "zorps" -> "zorp" by plural-s; "zorpt" sits one edit from "zorps" itself.
  const index = fakeIndex([entry("zorp", "n"), entry("zorpt", "n")]);
  const answer = lookupWord(index, "zorps");
  assert.equal(answer.exact, null);
  assert.equal(answer.viaInflection.length, 1);
  assert.equal(answer.viaInflection[0].lemma, "zorp");
  assert.deepEqual(answer.correction, []);
});

test("a true miss — no exact entry and no inflected hit — computes the correction", () => {
  // No "zorp" in the index, so the plural-s candidate resolves to nothing
  // and viaInflection stays empty; "zorpt" is one substitution from "zorps".
  const index = fakeIndex([entry("zorpt", "n")]);
  const answer = lookupWord(index, "zorps");
  assert.equal(answer.exact, null);
  assert.deepEqual(answer.viaInflection, []);
  assert.ok(answer.correction.includes("zorpt"), answer.correction.join(","));
});

test("an empty query answers nothing at all, even when the index carries a headword that normalises to the empty string", () => {
  const index = fakeIndex([entry("", "n")]);
  const answer = lookupWord(index, "");
  assert.deepEqual(answer, { query: "", exact: null, viaInflection: [], correction: [] });
});

// --- isImplausible: a comparative/superlative guess is dropped unless the target carries an adj sense ---

test("a comparative guess against a target with no adjective sense is dropped — the docstring's own \"beer\" example", () => {
  const index = fakeIndex([entry("be", "v"), entry("bee", "n")]);
  const answer = lookupWord(index, "beer");
  assert.ok(!answer.viaInflection.some((h) => h.lemma === "be"), JSON.stringify(answer.viaInflection));
  assert.ok(!answer.viaInflection.some((h) => h.lemma === "bee"), JSON.stringify(answer.viaInflection));
});

// --- isOverriddenByIrregularTable: a regular guess loses to the irregular table's own category ---

test("a past-tense guess against a lemma the irregular table governs as a verb is dropped", () => {
  // "beed" -> "be" by past-ed; "be" is IRREGULAR_FORMS's own lemma for
  // "was"/"were"/"been", so a regular "-ed" guess toward it never stands
  // when the target actually carries a verb sense.
  const index = fakeIndex([entry("be", "v")]);
  const answer = lookupWord(index, "beed");
  assert.ok(!answer.viaInflection.some((h) => h.lemma === "be" && h.rule === "past-ed"));
});

test("a past-tense guess against that same lemma stands when it carries no verb sense", () => {
  const index = fakeIndex([entry("be", "n")]);
  const answer = lookupWord(index, "beed");
  assert.ok(answer.viaInflection.some((h) => h.lemma === "be" && h.rule === "past-ed"));
});

test('a plural guess against a lemma the irregular table governs is dropped when the target is a noun and nothing else — "child", never reached through "childs"', () => {
  const index = fakeIndex([entry("child", "n")]);
  const answer = lookupWord(index, "childs");
  assert.ok(!answer.viaInflection.some((h) => h.lemma === "child" && h.rule === "plural-s"));
});

test('a plural guess against that same lemma stands when the target also carries a verb sense — RL-47\'s own "leave" case', () => {
  const index = fakeIndex([entry("child", "n"), entry("child", "v")]);
  const answer = lookupWord(index, "childs");
  assert.ok(answer.viaInflection.some((h) => h.lemma === "child" && h.rule === "plural-s"));
});

test("a plural guess against a lemma the table governs stands when the target is not even a noun", () => {
  const index = fakeIndex([entry("child", "adj")]);
  const answer = lookupWord(index, "childs");
  assert.ok(answer.viaInflection.some((h) => h.lemma === "child" && h.rule === "plural-s"));
});

// --- RL-47: the suffix pins a part of speech ahead of any frequency order ---

test("RL-47: an -ly form pins the adjective group ahead of the headword's own order", () => {
  // "zorq" carries v, n and adj senses. With no pin, POS_RANK alone would
  // order them v, n, adj (adj last) — the pin must move adj to the front.
  const index = fakeIndex([entry("zorq", "n"), entry("zorq", "v"), entry("zorq", "adj")]);
  const answer = lookupWord(index, "zorqly");
  assert.equal(answer.viaInflection.length, 1);
  const hit = answer.viaInflection[0];
  assert.equal(hit.lemma, "zorq");
  assert.equal(hit.rule, "adverb-ly");
  assert.deepEqual(
    hit.group.senses.map((s) => s.pos),
    ["adj", "v", "n"],
  );
});

// --- viaInflection: capped at 3, in the order lemmaCandidates yields them ---

test("viaInflection caps at 3 hits, keeping the first three the dictionary answers for", () => {
  // "better" -> identity, irregular "good", irregular "well", comparative
  // "bett", comparative "bet", comparative "bette": 5 non-identity
  // candidates once every lemma below is in the index.
  const index = fakeIndex([
    entry("good", "adj"),
    entry("well", "adj"),
    entry("bett", "adj"),
    entry("bet", "adj"),
    entry("bette", "adj"),
  ]);
  const answer = lookupWord(index, "better");
  assert.equal(answer.viaInflection.length, 3);
  assert.deepEqual(
    answer.viaInflection.map((hit) => hit.lemma),
    ["good", "well", "bett"],
  );
});

// --- hasEntry ---

test("hasEntry is true on an exact hit, true on an inflected hit, false on a miss", () => {
  const index = fakeIndex([entry("zorp", "n")]);
  assert.equal(hasEntry(index, "zorp"), true);
  assert.equal(hasEntry(index, "zorps"), true); // plural-s -> zorp
  assert.equal(hasEntry(index, "flibbertigibbet"), false);
});

// --- suggest: prefix search, sorted, capped, single-letter headwords excluded ---

test("suggest excludes a one-letter headword even when it is an exact prefix match", () => {
  const index = fakeIndex([entry("b", "n"), entry("bake", "v"), entry("bed", "n")]);
  assert.deepEqual(suggest(index, "b", 10), ["bake", "bed"]);
});

test("suggest returns at most limit results, the alphabetically first ones", () => {
  const index = fakeIndex([entry("cat", "n"), entry("cad", "n"), entry("car", "n")]);
  assert.deepEqual(suggest(index, "c", 2), ["cad", "car"]);
});

test("suggest returns nothing for an empty prefix or a non-positive limit", () => {
  const index = fakeIndex([entry("cat", "n")]);
  assert.deepEqual(suggest(index, "", 10), []);
  assert.deepEqual(suggest(index, "c", 0), []);
});

test("suggest returns nothing when no headword shares the prefix", () => {
  const index = fakeIndex([entry("cat", "n"), entry("dog", "n")]);
  assert.deepEqual(suggest(index, "zz", 10), []);
});

// --- property: suggest is exactly the sorted, answerable, prefix-matching set ---

test("property: suggest returns exactly the index's answerable headwords starting with the prefix, sorted, capped at limit", () => {
  let seed = 20260919;
  function rand(): number {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  const letters = "abc"; // a small alphabet forces real prefix collisions
  function randomWord(length: number): string {
    let out = "";
    for (let i = 0; i < length; i++) out += letters[Math.floor(rand() * letters.length)];
    return out;
  }

  for (let trial = 0; trial < 100; trial++) {
    const headwords = new Set<string>();
    const count = 1 + Math.floor(rand() * 15);
    for (let i = 0; i < count; i++) headwords.add(randomWord(1 + Math.floor(rand() * 3)));
    const prefix = randomWord(1 + Math.floor(rand() * 2));
    const limit = 1 + Math.floor(rand() * 5);

    const index = fakeIndex([...headwords].map((h) => entry(h, "n")));
    const expected = [...headwords]
      .filter((h) => h.startsWith(prefix))
      .filter((h) => h.length !== 1 || h === "a" || h === "i")
      .sort()
      .slice(0, limit);
    const actual = suggest(index, prefix, limit);
    assert.deepEqual(actual, expected, `headwords=${[...headwords].join(",")} prefix=${prefix} limit=${limit}`);
  }
});
