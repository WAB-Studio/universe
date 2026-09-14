/**
 * Measures RL-45's threshold over the shipped asset, in Node, with no
 * browser, no network and no database. Prints the whole ladder that led to
 * the chosen rule, not just the winner, so nobody has to re-derive it to
 * trust it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { manifestSchema } from "../lib/dictionary/format";
import { buildIndex, groupFor, type DictionaryIndex, type SenseGroup } from "../lib/dictionary/index-build";
import { isThinAnswer } from "../lib/word/thin";

const APP_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(APP_DIR, "public");
const MANIFEST_FULL_PATH = path.join(PUBLIC_DIR, "dictionary", "manifest.json");

let counter = 0;
let failed = false;
let passes = 0;
let failures = 0;

function next(name: string): string {
  counter += 1;
  return `D${counter}. ${name}`;
}

function assert(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (ok) passes += 1;
  else {
    failures += 1;
    failed = true;
  }
}

function report(): never {
  console.log("");
  console.log(`REPORT  ${passes} pass, ${failures} fail`);
  process.exit(failed ? 1 : 0);
}

const manifest = manifestSchema.parse(JSON.parse(readFileSync(MANIFEST_FULL_PATH, "utf8")));
const assetFullPath = path.join(PUBLIC_DIR, manifest.asset.path.replace(/^\//, ""));
const payload = JSON.parse(readFileSync(assetFullPath, "utf8"));
const index: DictionaryIndex = buildIndex(payload);
const lemmas = index.sortedHeadwords;
const groups: SenseGroup[] = lemmas.map((lemma) => groupFor(index, lemma)!);
const universe = groups.length;

function translationCount(group: SenseGroup): number {
  return group.senses.reduce((total, sense) => total + sense.translations.length, 0);
}
function hasNoDefinition(group: SenseGroup): boolean {
  return group.senses.every((sense) => sense.definition === null);
}
function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

// Distribution of translations per lemma, over the universe the running app
// groups senses into (`buildIndex` + `groupFor`), never the raw asset rows.
const translationCounts = groups.map(translationCount).sort((a, b) => a - b);
console.log("Translations per lemma:");
for (const p of [10, 25, 50, 75, 90]) {
  console.log(`  p${p}: ${percentile(translationCounts, p)}`);
}
console.log(`  max: ${translationCounts[translationCounts.length - 1]}`);
console.log("");

// The ladder that produced RL-45's rule, printed whole: every candidate this
// slice weighed, not only the one that shipped, so a future reader never has
// to re-run this file to see what the alternatives would have caught.
const LADDER: Record<string, (g: SenseGroup) => boolean> = {
  "<=3 translations and >=2 senses (the first-drafted rule)": (g) =>
    translationCount(g) <= 3 && g.senses.length >= 2,
  "<=4 translations and >=2 senses": (g) => translationCount(g) <= 4 && g.senses.length >= 2,
  "<=4 translations and (>=2 senses or no definition) — chosen": (g) =>
    isThinAnswer(g),
  "<=5 translations and (>=2 senses or no definition)": (g) =>
    translationCount(g) <= 5 && (g.senses.length >= 2 || hasNoDefinition(g)),
  "<=4 translations, no sense floor": (g) => translationCount(g) <= 4,
};

console.log("Ladder over the shipped index:");
for (const [label, rule] of Object.entries(LADDER)) {
  const caught = groups.filter(rule).length;
  console.log(`  ${label}: ${caught} of ${universe} (${((100 * caught) / universe).toFixed(1)}%)`);
}
console.log("");

// The verdict for the words this slice's measurement leaned on.
const NAMED_WORDS = ["snuff", "stern", "swish", "clamp", "black", "read"];
console.log("Verdict for the named words:");
for (const word of NAMED_WORDS) {
  const group = groupFor(index, word);
  const verdict = group ? isThinAnswer(group) : "no entry";
  console.log(`  ${word}: ${verdict}`);
}
console.log("");

assert(
  next("the shipped index groups into the universe reported by manifest.json"),
  universe === manifest.counts.headwords,
  `buildIndex produced ${universe} lemmas; manifest.json's own count is ${manifest.counts.headwords}`,
);

assert(
  next('isThinAnswer("snuff") is true'),
  isThinAnswer(groupFor(index, "snuff")!),
  "snuff has 2 senses and 3 translations",
);
assert(
  next('isThinAnswer("stern") is true'),
  isThinAnswer(groupFor(index, "stern")!),
  "stern has 2 senses and 4 translations",
);
for (const word of ["swish", "clamp", "black", "read"]) {
  assert(
    next(`isThinAnswer("${word}") is false`),
    !isThinAnswer(groupFor(index, word)!),
    `${word} is not thin under the chosen rule`,
  );
}

// The 8 words the chosen rule catches out of the 45 distinct words one real
// reader looked up in one chapter, 2026-09-12 (`docs/voyager/DESIGN.md`,
// "What one real chapter measured"). Proof against use, not only the asset.
const CHAPTER_THIN_WORDS = [
  "gilded",
  "sleet",
  "stern",
  "snuff",
  "envious",
  "edible",
  "shriek",
  "rejoice",
];
assert(
  next("the rule catches all 8 words the reader's own chapter measured as thin"),
  CHAPTER_THIN_WORDS.every((word) => {
    const group = groupFor(index, word);
    return group !== null && isThinAnswer(group);
  }),
  `8 of 45 distinct words the reader looked up 2026-09-12, 18% — the same order as 16.1% over the dictionary at large`,
);

report();
