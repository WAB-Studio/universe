// RL-02 and RL-03's own contract: the box never asks whether what was typed
// is a word or a sentence (RL-02), and the whole string is looked up in the
// local dictionary first — a multi-word headword such as "give up" answers
// as a word — before it is ever counted in tokens; only a lookup miss with
// more than one token becomes a phrase (RL-03). `PHRASE_MIN_TOKENS` and
// `PHRASE_MAX_TOKENS` are the two edges that decision reads.
import assert from "node:assert/strict";
import { test } from "node:test";

import { classify, PHRASE_MAX_TOKENS, PHRASE_MIN_TOKENS } from "./classify";

const NEVER_ENTRY = () => false;
const ALWAYS_ENTRY = () => true;

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
}

test("the exported edges are exactly 2 and 60, the numbers the caller's own cap reads", () => {
  assert.equal(PHRASE_MIN_TOKENS, 2);
  assert.equal(PHRASE_MAX_TOKENS, 60);
});

test("an empty string classifies as empty", () => {
  assert.deepEqual(classify("", NEVER_ENTRY), { kind: "empty" });
});

test("a whitespace-only string classifies as empty, not as a one-token word", () => {
  assert.deepEqual(classify("   ", NEVER_ENTRY), { kind: "empty" });
});

test("RL-03: a multi-word string the dictionary carries whole answers as a word, never counted into tokens", () => {
  const result = classify("give up", ALWAYS_ENTRY);
  assert.deepEqual(result, { kind: "word", text: "give up" });
});

test("isEntry is asked about the normalised form of the collapsed text, not the raw string", () => {
  const seen: string[] = [];
  classify("  Café!  ", (normalised) => {
    seen.push(normalised);
    return false;
  });
  assert.deepEqual(seen, ["café"]);
});

test("a non-entry single token answers as a word", () => {
  assert.deepEqual(classify("hello", NEVER_ENTRY), { kind: "word", text: "hello" });
});

test("a non-entry at exactly PHRASE_MIN_TOKENS (2) tokens answers as a phrase", () => {
  const result = classify(words(2), NEVER_ENTRY);
  assert.deepEqual(result, { kind: "phrase", text: words(2), tokens: 2 });
});

test("a non-entry one token short of the floor (1) never becomes a phrase", () => {
  const result = classify(words(1), NEVER_ENTRY);
  assert.equal(result.kind, "word");
});

test("a non-entry at 59 tokens answers as a phrase carrying its own count", () => {
  const result = classify(words(59), NEVER_ENTRY);
  assert.deepEqual(result, { kind: "phrase", text: words(59), tokens: 59 });
});

test("a non-entry at exactly PHRASE_MAX_TOKENS (60) tokens still answers as a phrase, with that count", () => {
  const result = classify(words(60), NEVER_ENTRY);
  assert.deepEqual(result, { kind: "phrase", text: words(60), tokens: 60 });
});

test("a non-entry past the ceiling (61) still reports an accurate token count — the cap is the caller's, not classify's own", () => {
  const result = classify(words(61), NEVER_ENTRY);
  assert.deepEqual(result, { kind: "phrase", text: words(61), tokens: 61 });
});

test("internal whitespace runs collapse to one space before both the entry check and the token count", () => {
  const seen: string[] = [];
  const result = classify("  dog    cat  ", (normalised) => {
    seen.push(normalised);
    return false;
  });
  assert.deepEqual(result, { kind: "phrase", text: "dog cat", tokens: 2 });
  assert.deepEqual(seen, ["dog cat"]);
});
