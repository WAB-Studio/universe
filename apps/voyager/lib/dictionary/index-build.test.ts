// RL-51's own contract: a headword carrying more than one pronunciation
// answers in one block per pronunciation, the blocks in the order the entry
// already had, and a headword carrying one answers with no grouping at all.
// Every index here is built through the real `buildIndex` and read through
// the real `groupFor`, so what a block holds is the order RL-43 and RL-47
// really produce — the senses themselves are invented, never the shipped
// corpus, except where a test names a headword `pos-frequency.ts` scores
// (`row`, `leave`) to put that measured order under the grouping.
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildIndex, groupFor, pronunciationBlocks, type DictionaryIndex, type Sense } from "./index-build";
import type { PartOfSpeech, RawEntry } from "./format";

function entry(
  headword: string,
  pos: PartOfSpeech,
  ipa: string | null,
  translation: string,
): RawEntry {
  return [headword, pos, ipa, [translation], null];
}

function fakeIndex(entries: RawEntry[]): DictionaryIndex {
  return buildIndex({ version: 1, entries });
}

function sensesOf(index: DictionaryIndex, headword: string): readonly Sense[] {
  const group = groupFor(index, headword);
  assert.ok(group !== null, `no group for ${headword}`);
  return group.senses;
}

// What the screen draws, flattened: the IPA that heads each block and the
// first translation of every sense under it, in order.
function drawn(blocks: ReturnType<typeof pronunciationBlocks>): [string | null, string[]][] {
  assert.ok(blocks !== null, "expected a grouped entry");
  return blocks.map((block) => [block.ipa, block.senses.map((sense) => sense.translations[0])]);
}

// `row`'s own five senses, as the asset carries them: two nouns and a verb
// on /rɑː/, a noun and a verb on /ɹaʊ/. `pos-frequency.ts` scores `row`
// "nv", so RL-43 puts every noun ahead of every verb and the two /ɹaʊ/
// senses land at positions three and five of five — the defect RL-51 names.
const ROW_ENTRIES: RawEntry[] = [
  entry("row", "n", "/rɑː/", "remo"),
  entry("row", "n", "/rɑː/", "fila"),
  entry("row", "n", "/ɹaʊ/", "pelea"),
  entry("row", "v", "/rɑː/", "remar"),
  entry("row", "v", "/ɹaʊ/", "pelear"),
];

// --- the grouping itself ---

test("RL-51: `row` answers as two blocks, /rɑː/ first, its two /ɹaʊ/ senses contiguous", () => {
  const senses = sensesOf(fakeIndex(ROW_ENTRIES), "row");

  assert.deepEqual(drawn(pronunciationBlocks(senses)), [
    ["/rɑː/", ["remo", "fila", "remar"]],
    ["/ɹaʊ/", ["pelea", "pelear"]],
  ]);
});

test("RL-51: the pronunciation of the sense the entry already led with heads it — no sense changes place at the top", () => {
  const senses = sensesOf(fakeIndex(ROW_ENTRIES), "row");
  const blocks = pronunciationBlocks(senses);
  assert.ok(blocks !== null);

  assert.equal(blocks[0].ipa, senses[0].ipa);
  assert.deepEqual(blocks[0].senses[0], senses[0]);
});

test("RL-51: a block's own senses keep RL-43's order — the nouns still lead the verb inside /rɑː/", () => {
  const blocks = pronunciationBlocks(sensesOf(fakeIndex(ROW_ENTRIES), "row"));
  assert.ok(blocks !== null);

  assert.deepEqual(
    blocks[0].senses.map((sense) => sense.pos),
    ["n", "n", "v"],
  );
});

test("RL-51: RL-47's pinned category still outranks the frequency order inside a block", () => {
  // "rowing" pins the verb, so `groupFor` leads with it; the gathering only
  // moves the senses it was interleaved with, never past it.
  const index = fakeIndex(ROW_ENTRIES);
  const group = groupFor(index, "row", "v");
  assert.ok(group !== null);
  const blocks = pronunciationBlocks(group.senses);

  assert.deepEqual(drawn(blocks), [
    ["/rɑː/", ["remar", "remo", "fila"]],
    ["/ɹaʊ/", ["pelear", "pelea"]],
  ]);
});

test("RL-51: three pronunciations answer as three blocks, each in the order its own first sense had", () => {
  const index = fakeIndex([
    entry("zorp", "v", "/c/", "ce"),
    entry("zorp", "n", "/a/", "a"),
    entry("zorp", "n", "/b/", "be"),
    entry("zorp", "n", "/a/", "a segunda"),
    entry("zorp", "adj", "/b/", "be tercera"),
  ]);

  // POS_RANK alone orders this headword (`pos-frequency.ts` scores no
  // "zorp"): v, then the three nouns, then the adjective.
  assert.deepEqual(drawn(pronunciationBlocks(sensesOf(index, "zorp"))), [
    ["/c/", ["ce"]],
    ["/a/", ["a", "a segunda"]],
    ["/b/", ["be", "be tercera"]],
  ]);
});

test("RL-51: no sense is lost or repeated by the gathering — the blocks hold the entry whole", () => {
  const senses = sensesOf(fakeIndex(ROW_ENTRIES), "row");
  const blocks = pronunciationBlocks(senses);
  assert.ok(blocks !== null);

  const gathered = blocks.flatMap((block) => block.senses);
  assert.equal(gathered.length, senses.length);
  for (const sense of senses) assert.ok(gathered.includes(sense), sense.translations[0]);
});

// --- the 59,148 headwords that must not move ---

test("RL-51: one pronunciation is no grouping — `leave` answers with no block at all", () => {
  // `pos-frequency.ts` scores `leave` "vn": «dejar» leads «permiso», the
  // order RL-43 is credited for, and RL-51 must leave it exactly there.
  const index = fakeIndex([entry("leave", "n", "/liv/", "permiso"), entry("leave", "v", "/liv/", "dejar")]);
  const senses = sensesOf(index, "leave");

  assert.deepEqual(
    senses.map((sense) => sense.translations[0]),
    ["dejar", "permiso"],
  );
  assert.equal(pronunciationBlocks(senses), null);
});

test("RL-51: a headword whose senses carry no IPA at all draws no block", () => {
  const index = fakeIndex([entry("zorp", "n", null, "uno"), entry("zorp", "v", null, "dos")]);

  assert.equal(pronunciationBlocks(sensesOf(index, "zorp")), null);
});

test("RL-51: one pronunciation beside a sense carrying none is still one pronunciation, so nothing groups", () => {
  // 134 headwords of the asset have this shape. A head drawn over half of
  // one would be a change to an entry that reads the same without it.
  const index = fakeIndex([entry("zorp", "n", "/z/", "uno"), entry("zorp", "v", null, "dos")]);

  assert.equal(pronunciationBlocks(sensesOf(index, "zorp")), null);
});

test("RL-51: a single sense never groups, whatever it carries", () => {
  const index = fakeIndex([entry("zorp", "n", "/z/", "uno")]);

  assert.equal(pronunciationBlocks(sensesOf(index, "zorp")), null);
});

// --- the two headwords where a nameless block does share an entry ---

test("RL-51: two pronunciations beside a sense carrying none gather into three blocks, the nameless one last", () => {
  // `can` and `pace` are the asset's only two: normalising folds a proper
  // noun (`CAN`, `PACE`) — which carries no IPA — into the word's own
  // entry. That block is drawn with no head, never dropped.
  const index = fakeIndex([
    entry("can", "v", "/kən/", "poder"),
    entry("can", "v", "/ˈkæn/", "enlatar"),
    entry("can", "n", "/ˈkæn/", "lata"),
    entry("can", "pn", null, "CAN"),
  ]);

  assert.deepEqual(drawn(pronunciationBlocks(sensesOf(index, "can"))), [
    ["/kən/", ["poder"]],
    ["/ˈkæn/", ["enlatar", "lata"]],
    [null, ["CAN"]],
  ]);
});
