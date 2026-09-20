// RL-45's own rule: at most 4 translations, summed across every sense, and
// either more than one sense or no definition at all. `check-thinness.ts`
// already measures this ladder over the shipped index and named words;
// this drives the arithmetic itself, one clause at a time, at its exact
// edges — never repeating a named word from that script.
import assert from "node:assert/strict";
import { test } from "node:test";

import { isThinAnswer } from "./thin";
import type { Sense, SenseGroup } from "../dictionary/index-build";

function sense(overrides: Partial<Sense> = {}): Sense {
  return { pos: "n", ipa: null, translations: [], definition: "a definition", ...overrides };
}

function group(senses: Sense[]): SenseGroup {
  return { headword: "x", senses };
}

// --- translationCount <= 4, isolated from the sense-count clause by
// holding senses.length at 2 (so the OR's other side is already true) ---

test("translationCount at exactly 4, with two senses, is thin", () => {
  const g = group([sense({ translations: ["a", "b"] }), sense({ translations: ["c", "d"] })]);
  assert.equal(isThinAnswer(g), true);
});

test("translationCount one past the limit (5), with the same two senses, is not thin", () => {
  const g = group([sense({ translations: ["a", "b"] }), sense({ translations: ["c", "d", "e"] })]);
  assert.equal(isThinAnswer(g), false);
});

// --- senses.length >= 2, isolated from hasNoDefinition by giving every
// sense a real definition ---

test("exactly two senses, each with a real definition and few translations, is thin", () => {
  const g = group([
    sense({ translations: ["a"], definition: "one" }),
    sense({ translations: ["b"], definition: "two" }),
  ]);
  assert.equal(isThinAnswer(g), true);
});

test("one sense short of that floor, same translation count and a real definition, is not thin", () => {
  const g = group([sense({ translations: ["a", "b"], definition: "one" })]);
  assert.equal(isThinAnswer(g), false);
});

// --- hasNoDefinition, isolated to a single sense (the only shape where it
// decides anything: two-or-more senses already satisfy the OR on their own) ---

test("a single sense with no definition at all is thin", () => {
  const g = group([sense({ translations: ["a", "b"], definition: null })]);
  assert.equal(isThinAnswer(g), true);
});

test("that same single sense, with a real definition, is not thin", () => {
  const g = group([sense({ translations: ["a", "b"], definition: "one" })]);
  assert.equal(isThinAnswer(g), false);
});

// --- the two clauses are ANDed, not ORed ---

test("many translations across multiple senses is not thin, even though the sense-count clause alone would be true", () => {
  const g = group([
    sense({ translations: ["a", "b", "c", "d"] }),
    sense({ translations: ["e", "f", "g", "h"] }),
  ]);
  assert.equal(isThinAnswer(g), false);
});

// --- translationCount sums across every sense, not just one ---

test("translationCount is the sum of every sense's translations, not any single sense's own count", () => {
  // Each sense alone carries 2 (<=4), but the group's total is 4, exactly
  // at the limit — a rule that read only one sense would call this thin
  // for the wrong reason, or miss the boundary the sum actually sits on.
  const atLimit = group([
    sense({ translations: ["a", "b"], definition: "one" }),
    sense({ translations: ["c", "d"], definition: "two" }),
  ]);
  assert.equal(isThinAnswer(atLimit), true);

  // Bumping one sense's own count by one pushes the sum to 5, past the
  // limit, while every single sense still carries 4 or fewer on its own.
  const overLimit = group([
    sense({ translations: ["a", "b", "c"], definition: "one" }),
    sense({ translations: ["d", "e"], definition: "two" }),
  ]);
  assert.equal(isThinAnswer(overLimit), false);
});
