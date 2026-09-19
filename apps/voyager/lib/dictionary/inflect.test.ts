// RL-47's contract: a typed form resolves to the headword it inflects from,
// by a table lookup first and a suffix guess after, ranked by confidence,
// deduplicated and capped. Cases are built from a random stem and a fixed
// seed rather than hand-typed, one per suffix family the module declares.
import assert from "node:assert/strict";
import { test } from "node:test";

import { normaliseHeadword } from "./format";
import { IRREGULAR_FORMS } from "./irregular-forms";
import { lemmaCandidates } from "./inflect";

const MAX_CANDIDATES = 12;

// Every invariant the contract makes regardless of the word: identity
// leads, no lemma repeats, and the list never grows past the module's cap.
function assertInvariants(surface: string, candidates: ReturnType<typeof lemmaCandidates>): void {
  assert.ok(candidates.length > 0, `${surface}: at least identity`);
  assert.equal(candidates[0].lemma, normaliseHeadword(surface), `${surface}: identity leads`);
  assert.equal(candidates[0].rule, "identity", `${surface}: identity leads`);
  const lemmas = candidates.map((c) => c.lemma);
  assert.equal(new Set(lemmas).size, lemmas.length, `${surface}: no duplicate lemma`);
  assert.ok(candidates.length <= MAX_CANDIDATES, `${surface}: at most ${MAX_CANDIDATES} candidates`);
}

function hasCandidate(
  candidates: ReturnType<typeof lemmaCandidates>,
  lemma: string,
  rule: string,
): boolean {
  return candidates.some((c) => c.lemma === lemma && c.rule === rule);
}

let seed = 20260919;
function rand(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const VOWELS = "aeiou";
const CONSONANTS = "bcdfghjklmnpqrstvwxz";
function randomStem(length: number, lastConsonant = false): string {
  let out = "";
  for (let i = 0; i < length - (lastConsonant ? 1 : 0); i++) {
    const alphabet = i % 2 === 0 ? CONSONANTS : VOWELS;
    out += alphabet[Math.floor(rand() * alphabet.length)];
  }
  if (lastConsonant) out += CONSONANTS[Math.floor(rand() * CONSONANTS.length)];
  return out;
}

test("identity always leads, with no duplicate lemma and at most 12 candidates — checked on every case below", () => {
  for (const surface of ["dog", "Running.", "  THE-cat's  ", "a"]) {
    assertInvariants(surface, lemmaCandidates(surface));
  }
});

test("every surface IRREGULAR_FORMS names resolves to every lemma it lists, tagged 'irregular'", () => {
  for (const [surface, lemmas] of IRREGULAR_FORMS) {
    const candidates = lemmaCandidates(surface);
    assertInvariants(surface, candidates);
    for (const lemma of lemmas) {
      assert.ok(hasCandidate(candidates, lemma, "irregular"), `${surface} -> ${lemma}`);
    }
  }
});

// One trial per suffix family the module declares, over a random stem a
// fixed seed regenerates every run. A stem this file mints is checked
// against IRREGULAR_FORMS first: a synthetic collision would make the
// rule's own candidate untestable, not wrong, so the trial is skipped.
const TRIALS = 40;

function trial(build: (stem: string) => { surface: string; lemma: string; rule: string }[]): void {
  for (let i = 0; i < TRIALS; i++) {
    const stem = randomStem(3 + Math.floor(rand() * 3));
    if (IRREGULAR_FORMS.has(stem)) continue;
    for (const { surface, lemma, rule } of build(stem)) {
      const candidates = lemmaCandidates(surface);
      assertInvariants(surface, candidates);
      assert.ok(hasCandidate(candidates, lemma, rule), `${surface} -> {lemma: ${lemma}, rule: ${rule}}`);
    }
  }
}

test("plural-s: stem + 's' resolves to stem", () => {
  trial((stem) => [{ surface: stem + "s", lemma: stem, rule: "plural-s" }]);
});

test("plural-es: stem + 'es' resolves to stem", () => {
  trial((stem) => [{ surface: stem + "es", lemma: stem, rule: "plural-es" }]);
});

test("plural-ies: stem + 'ies' resolves to stem + 'y'", () => {
  trial((stem) => [{ surface: stem + "ies", lemma: stem + "y", rule: "plural-ies" }]);
});

test("past-ed: stem + 'ed' resolves both to stem and to stem + 'e' (the dropped-e stem)", () => {
  trial((stem) => [
    { surface: stem + "ed", lemma: stem, rule: "past-ed" },
    { surface: stem + "ed", lemma: stem + "e", rule: "past-ed" },
  ]);
});

test("past-ied: stem + 'ied' resolves to stem + 'y'", () => {
  trial((stem) => [{ surface: stem + "ied", lemma: stem + "y", rule: "past-ied" }]);
});

test("past-doubled: a doubled final consonant + 'ed' resolves to the single-consonant stem", () => {
  for (let i = 0; i < TRIALS; i++) {
    const stem = randomStem(3 + Math.floor(rand() * 3), true);
    if (IRREGULAR_FORMS.has(stem)) continue;
    const last = stem[stem.length - 1];
    const surface = stem + last + "ed";
    const candidates = lemmaCandidates(surface);
    assertInvariants(surface, candidates);
    assert.ok(hasCandidate(candidates, stem, "past-doubled"), surface);
  }
});

test("past-doubled: two different consonants before 'ed' is not a doubled pair — no past-doubled candidate", () => {
  for (let i = 0; i < TRIALS; i++) {
    const stem = randomStem(3 + Math.floor(rand() * 3));
    if (IRREGULAR_FORMS.has(stem)) continue;
    const first = CONSONANTS[Math.floor(rand() * CONSONANTS.length)];
    let second = CONSONANTS[Math.floor(rand() * CONSONANTS.length)];
    while (second === first) second = CONSONANTS[Math.floor(rand() * CONSONANTS.length)];
    const surface = stem + first + second + "ed";
    const candidates = lemmaCandidates(surface);
    assertInvariants(surface, candidates);
    assert.ok(!hasCandidate(candidates, stem + first, "past-doubled"), surface);
  }
});

test("past-doubled: a doubled vowel before 'ed' is not a doubled consonant — no past-doubled candidate", () => {
  for (let i = 0; i < TRIALS; i++) {
    const stem = randomStem(3 + Math.floor(rand() * 3));
    if (IRREGULAR_FORMS.has(stem)) continue;
    const vowel = VOWELS[Math.floor(rand() * VOWELS.length)];
    const surface = stem + vowel + vowel + "ed";
    const candidates = lemmaCandidates(surface);
    assertInvariants(surface, candidates);
    assert.ok(!hasCandidate(candidates, stem + vowel, "past-doubled"), surface);
  }
});

test("ing: stem + 'ing' resolves both to stem and to stem + 'e' (ing-e)", () => {
  trial((stem) => [
    { surface: stem + "ing", lemma: stem, rule: "ing" },
    { surface: stem + "ing", lemma: stem + "e", rule: "ing-e" },
  ]);
});

test("ing-doubled: a doubled final consonant + 'ing' resolves to the single-consonant stem", () => {
  for (let i = 0; i < TRIALS; i++) {
    const stem = randomStem(3 + Math.floor(rand() * 3), true);
    if (IRREGULAR_FORMS.has(stem)) continue;
    const last = stem[stem.length - 1];
    const surface = stem + last + "ing";
    const candidates = lemmaCandidates(surface);
    assertInvariants(surface, candidates);
    assert.ok(hasCandidate(candidates, stem, "ing-doubled"), surface);
  }
});

test("comparative: stem + 'er' resolves to stem and to stem + 'e'; stem + 'ier' resolves to stem + 'y'", () => {
  trial((stem) => [
    { surface: stem + "er", lemma: stem, rule: "comparative" },
    { surface: stem + "er", lemma: stem + "e", rule: "comparative" },
    { surface: stem + "ier", lemma: stem + "y", rule: "comparative" },
  ]);
});

test("superlative: stem + 'est' resolves to stem and to stem + 'e'; stem + 'iest' resolves to stem + 'y'", () => {
  trial((stem) => [
    { surface: stem + "est", lemma: stem, rule: "superlative" },
    { surface: stem + "est", lemma: stem + "e", rule: "superlative" },
    { surface: stem + "iest", lemma: stem + "y", rule: "superlative" },
  ]);
});

test("adverb-ly: stem + 'ly' resolves to stem; stem + 'ily' resolves to stem + 'y'", () => {
  trial((stem) => [
    { surface: stem + "ly", lemma: stem, rule: "adverb-ly" },
    { surface: stem + "ily", lemma: stem + "y", rule: "adverb-ly" },
  ]);
});

test("possessive: stem + \"'s\" resolves to stem", () => {
  trial((stem) => [{ surface: stem + "'s", lemma: stem, rule: "possessive" }]);
});
