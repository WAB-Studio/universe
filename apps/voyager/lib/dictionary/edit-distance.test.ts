// RL-28's contract: a query one edit away from a real headword is offered
// back, computed on the device, never over the network. Every assertion
// here is checked against a reference edit distance this file computes on
// its own — never against what `suggestCorrection` happens to return today.
import assert from "node:assert/strict";
import { test } from "node:test";

import { suggestCorrection } from "./edit-distance";
import type { DictionaryIndex } from "./index-build";
import { POS_FREQUENCY_ORDER } from "./pos-frequency";

function fakeIndex(headwords: Iterable<string>): DictionaryIndex {
  const byHeadword = new Map<string, number[]>();
  for (const headword of headwords) byHeadword.set(headword, [0]);
  return { entries: [], byHeadword, sortedHeadwords: [...headwords] };
}

// Optimal string alignment distance: delete, insert, substitute and one
// adjacent transpose, the same four operations `editsAtDistanceOne`
// generates — by dynamic programming, independent of that generator.
function osaDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

test("a query shorter than two characters offers nothing", () => {
  assert.deepEqual(suggestCorrection(fakeIndex(["ab", "cd"]), "a"), []);
});

test("a query with a space offers nothing — a sentence is never corrected", () => {
  assert.deepEqual(suggestCorrection(fakeIndex(["give up"]), "giv up"), []);
});

test("no headword one edit away offers nothing", () => {
  assert.deepEqual(suggestCorrection(fakeIndex(["completely", "unrelated"]), "zzqqxv"), []);
});

test('RL-44\'s own example: a typo of "whereas" offers it back', () => {
  const index = fakeIndex(["whereas", "somethingelse"]);
  assert.ok(suggestCorrection(index, "whereat").includes("whereas"));
});

test("a headword the frequency table has measured sorts ahead of one it has never measured, even against alphabetical order", () => {
  const rowed = "book";
  const unrowed = "aook";
  assert.ok(POS_FREQUENCY_ORDER.has(rowed));
  assert.ok(!POS_FREQUENCY_ORDER.has(unrowed));
  // Both are one substitution from "hook"; "aook" alone would sort first.
  const index = fakeIndex([rowed, unrowed]);
  assert.deepEqual(suggestCorrection(index, "hook"), [rowed, unrowed]);
});

test("the transpose generator never reaches past the query's own last character", () => {
  // At the query's last position there is nothing to swap; a headword
  // shaped like that missing swap (`left` + the literal text an
  // off-by-one there would splice in) is never a real one-edit offer.
  const query = "cat";
  const bogus = "ca" + "undefined" + "t";
  const index = fakeIndex([bogus, "cad"]);
  const offered = suggestCorrection(index, query);
  assert.ok(!offered.includes(bogus), offered.join(","));
  assert.deepEqual(offered, ["cad"]);
});

test("property: the offer is exactly the index's headwords at reference distance 1, no more and no fewer", () => {
  let seed = 20260919;
  function rand(): number {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  const letters = "abcdefghijklmnopqrstuvwxyz";
  function letter(): string {
    return letters[Math.floor(rand() * letters.length)];
  }
  function randomWord(length: number): string {
    let out = "";
    for (let i = 0; i < length; i++) out += letter();
    return out;
  }
  function mutateOnce(word: string): string {
    const i = Math.floor(rand() * word.length);
    switch (Math.floor(rand() * 4)) {
      case 0:
        return word.length > 1 ? word.slice(0, i) + word.slice(i + 1) : word;
      case 1:
        return word.slice(0, i) + letter() + word.slice(i);
      case 2:
        return word.slice(0, i) + letter() + word.slice(i + 1);
      default: {
        const j = Math.min(i, word.length - 2);
        return word.length > 1 ? word.slice(0, j) + word[j + 1] + word[j] + word.slice(j + 2) : word;
      }
    }
  }

  for (let trial = 0; trial < 200; trial++) {
    const query = randomWord(3 + Math.floor(rand() * 5));
    const candidates = new Set<string>();
    for (let i = 0; i < 10; i++) candidates.add(mutateOnce(query)); // mostly distance 1
    for (let i = 0; i < 5; i++) candidates.add(mutateOnce(mutateOnce(query))); // mostly distance 2
    candidates.add(randomWord(3 + Math.floor(rand() * 5))); // near-certainly distance > 2

    const index = fakeIndex(candidates);
    const expected = [...candidates].filter((c) => osaDistance(query, c) === 1).sort();
    const actual = [...suggestCorrection(index, query)].sort();
    assert.deepEqual(actual, expected, `query=${query} candidates=${[...candidates].join(",")}`);
  }
});
