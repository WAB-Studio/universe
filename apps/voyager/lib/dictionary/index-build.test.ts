// RL-51's own contract: a headword carrying more than one pronunciation
// answers in one block per pronunciation, the blocks in the order the entry
// already had, and a headword carrying one answers with no grouping at all.
// Every index here is built through the real `buildIndex` and read through
// the real `groupFor`, so what a block holds is the order RL-43 and RL-47
// really produce — the senses themselves are invented, never the shipped
// corpus, except where a test names a headword `pos-frequency.ts` scores
// (`row`, `leave`) to put that measured order under the grouping.
//
// The last four tests are the exception on purpose: RL-51's claim is
// exhaustive — *every* headword carrying more than one pronunciation draws
// each of them in one run — and a claim over the corpus can only be proved
// over the corpus. They drive the shipped asset through the same
// `buildIndex`, and they derive the set they check instead of carrying a
// list: that census has been written down wrong twice already
// (docs/voyager/SPEC.md RL-51, "Measure this on the normalised headword").
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { buildIndex, groupFor, ipaKey, pronunciationBlocks, type DictionaryIndex, type Sense } from "./index-build";
import type { DictionaryPayload, PartOfSpeech, RawEntry } from "./format";
import manifest from "../../public/dictionary/manifest.json";

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

// --- one sound, written several ways ---

test("RL-51: the comparison key drops notation and a leading stress, and keeps every mark inside the word", () => {
  // Syllable dots, a tie bar and parentheses are how the asset writes, not
  // what a reader hears; a mark the word carries at position 0 is no
  // distinction either, since the word has only one stress to place.
  assert.equal(ipaKey("/ˈdeɪ.zi/"), ipaKey("/ˈdeɪzi/"));
  assert.equal(ipaKey("/ˈd͡ʒɑn/"), ipaKey("/d͡ʒɑn/"));
  assert.equal(ipaKey("/ɡɑ(d)/"), ipaKey("/ɡɑd/"));
  assert.equal(ipaKey("/hoʊp/"), ipaKey("/ˈhoʊp/"));

  // A stress inside the word is the noun-verb distinction itself, and a
  // secondary stress is a mark of its own — `canton` carries both spellings
  // and is two words.
  assert.notEqual(ipaKey("/ɪmˈpɹɪnt/"), ipaKey("/ˈɪm.pɹɪnt/"));
  assert.notEqual(ipaKey("/ˈkæntɒn/"), ipaKey("/ˈkænˌtɒn/"));
});

test("RL-51: two spellings of one sound are one pronunciation, so the entry draws no block", () => {
  // `hope`'s own three senses, as the asset carries them: the proper noun
  // writes the stress the other two leave off. Before this the entry split
  // in two and told the reader those sounds differ.
  const index = fakeIndex([
    entry("hope", "v", "/hoʊp/", "esperar"),
    entry("hope", "n", "/hoʊp/", "esperanza"),
    entry("hope", "pn", "/ˈhoʊp/", "Hope"),
  ]);

  assert.equal(pronunciationBlocks(sensesOf(index, "hope")), null);
});

test("RL-51: a stress inside the word still separates the noun from the verb", () => {
  // `imprint`'s own two IPAs, under a headword `pos-frequency.ts` scores no
  // row for, so POS_RANK alone orders them and the verb leads.
  const index = fakeIndex([
    entry("zorp", "n", "/ˈɪm.pɹɪnt/", "huella"),
    entry("zorp", "v", "/ɪmˈpɹɪnt/", "imprimir"),
  ]);

  assert.deepEqual(drawn(pronunciationBlocks(sensesOf(index, "zorp"))), [
    ["/ɪmˈpɹɪnt/", ["imprimir"]],
    ["/ˈɪm.pɹɪnt/", ["huella"]],
  ]);
});

test("RL-51: the block wears the spelling of its own first sense, never a normalised one", () => {
  const index = fakeIndex([
    entry("zorp", "v", "/ˈdeɪ.zi/", "uno"),
    entry("zorp", "n", "/ˈdeɪzi/", "dos"),
    entry("zorp", "adj", "/zɔːp/", "tres"),
  ]);
  const blocks = pronunciationBlocks(sensesOf(index, "zorp"));
  assert.ok(blocks !== null);

  assert.equal(blocks[0].ipa, "/ˈdeɪ.zi/");
  assert.deepEqual(
    blocks[0].senses.map((sense) => sense.translations[0]),
    ["uno", "dos"],
  );
});

// --- the 58,770 headwords that must not move ---

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

// --- the shipped asset, every headword of it ---

// The asset the app really installs, found the way `check-dictionary.ts`
// finds it: the manifest names the file. The payload is cast, not parsed —
// 64,258 entries through a Zod schema buys nothing for a question about
// order, and `buildIndex` is the thing under test either way.
function shippedIndex(): DictionaryIndex {
  const assetPath = path.join(__dirname, "../../public", manifest.asset.path);
  const payload = JSON.parse(readFileSync(assetPath, "utf8")) as DictionaryPayload;
  return buildIndex(payload);
}

// Everything RL-51 promises about one headword, read off the sequence the
// screen would really draw — the blocks flattened back into senses — rather
// than off the block structure that produced it. Returns what is wrong with
// the entry, or null when nothing is.
function defectOf(index: DictionaryIndex, headword: string): string | null {
  const group = groupFor(index, headword);
  if (group === null) return "no group at all";
  const senses = group.senses;
  // Counted by sound, never by spelling: `hope` writes one sound two ways
  // and owes the reader one block, not two (RL-51, `ipaKey`).
  const sound = (sense: Sense): string | null => (sense.ipa === null ? null : ipaKey(sense.ipa));
  const named = new Set(senses.filter((sense) => sense.ipa !== null).map(sound));
  const blocks = pronunciationBlocks(senses);

  if (named.size < 2) return blocks === null ? null : "grouped on one pronunciation";
  if (blocks === null) return "carries more than one pronunciation and did not group";

  const drawn = blocks.flatMap((block) => block.senses);
  if (drawn.length !== senses.length) return `${senses.length} senses drawn as ${drawn.length}`;
  if (senses.some((sense) => !drawn.includes(sense))) return "a sense was lost or repeated";
  if (drawn[0] !== senses[0]) return "the entry changed which sense leads it";

  // Contiguity: a pronunciation opens exactly once down the entry. Counted
  // over the drawn senses themselves, so a block per sense — the shape the
  // defect had before RL-51 — reads as more runs than pronunciations.
  const runs = drawn.filter((sense, at) => at === 0 || sound(sense) !== sound(drawn[at - 1])).length;
  const pronunciations = new Set(drawn.map(sound)).size;
  if (runs !== pronunciations) return `${pronunciations} pronunciations drawn in ${runs} runs`;

  for (const block of blocks) {
    const places = block.senses.map((sense) => senses.indexOf(sense));
    if (places.some((place, at) => at > 0 && place < places[at - 1])) return "a block reordered its own senses";
  }

  // docs/voyager/SPEC.md RL-51: the block no pronunciation heads is drawn
  // last. `can` and `pace` are the only two entries that have one.
  const nameless = blocks.findIndex((block) => block.ipa === null);
  if (nameless !== -1 && nameless !== blocks.length - 1) return "the block with no pronunciation is not last";
  return null;
}

test("RL-51: every headword of the shipped asset draws each of its pronunciations in one run", () => {
  const index = shippedIndex();

  const defects = index.sortedHeadwords
    .map((headword) => ({ headword, defect: defectOf(index, headword) }))
    .filter((audited): audited is { headword: string; defect: string } => audited.defect !== null);

  assert.deepEqual(
    defects.slice(0, 10),
    [],
    `${defects.length} of ${index.sortedHeadwords.length} headwords draw wrong`,
  );
});

test("RL-51: the census docs/voyager/SPEC.md records is the one the app's own index produces", () => {
  const index = shippedIndex();
  assert.equal(index.sortedHeadwords.length, manifest.counts.headwords);

  let multiple = 0;
  let interleaved = 0;
  let nameless = 0;
  for (const headword of index.sortedHeadwords) {
    const group = groupFor(index, headword);
    assert.ok(group !== null);
    const blocks = pronunciationBlocks(group.senses);
    if (blocks === null) continue;
    multiple++;
    if (blocks.some((block) => block.ipa === null)) nameless++;
    // Interleaved: the gathering really moved a sense, which is the defect
    // RL-51 names — the rest were contiguous before it ran.
    const drawn = blocks.flatMap((block) => block.senses);
    if (drawn.some((sense, at) => sense !== group.senses[at])) interleaved++;
  }

  assert.equal(multiple, 174, "headwords carrying more than one named pronunciation");
  assert.equal(interleaved, 24, "of those, the ones whose senses the gathering really moves");
  assert.equal(nameless, 2, "of those, the ones carrying a sense with no pronunciation (`can`, `pace`)");
  assert.equal(defectOf(index, "row"), null);
});

test("RL-51: exactly the 16 headwords that split on notation alone stop splitting, and no other does", () => {
  const index = shippedIndex();

  // Derived, never listed: a headword carrying more than one *spelling*
  // that answers with no block at all is one the normalisation folded.
  const folded = index.sortedHeadwords.filter((headword) => {
    const senses = groupFor(index, headword)!.senses;
    const spellings = new Set(senses.filter((sense) => sense.ipa !== null).map((sense) => sense.ipa));
    return spellings.size > 1 && pronunciationBlocks(senses) === null;
  });

  assert.deepEqual(folded, [
    "buffalo",
    "calliope",
    "daisy",
    "flora",
    "god",
    "ham",
    "hope",
    "iron curtain",
    "john",
    "majesty",
    "mass",
    "mercury",
    "o",
    "roger",
    "trinity",
    "tyre",
  ]);
});

test("RL-51: the homographs a stress inside the word really separates still answer in two blocks", () => {
  // Noun-stress against verb-stress, which is the distinction RL-51 exists
  // to draw. `english` and `facebook` are here for the same reason and
  // through other marks: a stress mid-word, and a secondary stress.
  const index = shippedIndex();

  for (const headword of ["imprint", "invite", "mandate", "canton", "koine", "english", "facebook"]) {
    const blocks = pronunciationBlocks(groupFor(index, headword)!.senses);
    assert.ok(blocks !== null, `${headword} stopped grouping`);
    assert.equal(blocks.length, 2, `${headword} drew ${blocks.length} blocks`);
  }
});
