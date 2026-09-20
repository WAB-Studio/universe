// RL-44's gate: a string reaches the network and the database only in the
// shape the shipped index's own headwords already have — one token,
// lowercase, `'` and `-` allowed inside but not alone. `admit.test.ts`
// drives the module's own arithmetic (MAX_HYPHENS, MIN_LETTERS) at its
// exact edges; `check-admission.ts` already drives it over the shipped
// asset and a named list, so this never repeats that list.
import assert from "node:assert/strict";
import { test } from "node:test";

import { admitWord } from "./admit";

test("a well-formed lowercase word is admitted, unchanged", () => {
  assert.equal(admitWord("hello"), "hello");
});

test("a string whose normalisation strips a leading character is rejected outright, never admitted as the trimmed word", () => {
  // "!" is trimmed by normaliseHeadword but is not part of the shape a
  // caller is allowed to have typed, so the mismatch itself must refuse —
  // "hello" must never appear as the answer here.
  assert.equal(admitWord("!hello"), null);
});

test("doubled internal whitespace is rejected, never collapsed and admitted", () => {
  assert.equal(admitWord("hello  world"), null);
});

test("exactly MAX_HYPHENS (2) hyphens is admitted", () => {
  assert.equal(admitWord("a-b-c"), "a-b-c");
});

test("one hyphen past MAX_HYPHENS (3) is rejected", () => {
  assert.equal(admitWord("a-b-c-d"), null);
});

test("exactly MIN_LETTERS (2) letters is admitted", () => {
  assert.equal(admitWord("ab"), "ab");
});

test("one letter short of MIN_LETTERS (1 letter, padded to a valid shape by a hyphen) is rejected", () => {
  assert.equal(admitWord("a-"), null);
});

test("a digit inside an otherwise word-shaped string is rejected, even though its hyphen and letter counts alone would pass", () => {
  assert.equal(admitWord("hello2"), null);
});
