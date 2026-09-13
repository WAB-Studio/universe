import { normaliseHeadword, type DictionaryPayload, type PartOfSpeech, type RawEntry } from "./format";
import type { InflectionRule } from "./inflect";
import { POS_FREQUENCY_ORDER } from "./pos-frequency";

export type Sense = {
  pos: PartOfSpeech;
  ipa: string | null;
  translations: readonly string[];
  definition: string | null;
};

export type SenseGroup = { headword: string; senses: readonly Sense[] };

// Opaque to callers: reach it only through buildIndex, groupFor, lookupWord
// and suggest. byHeadword and sortedHeadwords answer a lookup and a prefix
// search without ever re-scanning the entries array.
export type DictionaryIndex = {
  readonly entries: readonly RawEntry[];
  readonly byHeadword: Map<string, number[]>;
  readonly sortedHeadwords: string[];
};

// The fallback order, for a headword pos-frequency.ts carries no row for:
// v before n before adj before adv before pn before phraseologicalUnit.
// Exported for build-pos-frequency.ts alone, to measure against this same
// rank rather than a second copy of it.
export const POS_RANK: Record<PartOfSpeech, number> = {
  v: 0,
  n: 1,
  adj: 2,
  adv: 3,
  pn: 4,
  phraseologicalUnit: 5,
};

// RL-47's suffix clause: only a verb takes "-ing" or "-ed", only an
// adjective takes "-ly", and a plural names a noun. A rule not listed here
// —identity, irregular, comparative, superlative, possessive— strips no
// suffix that fixes a category, so it pins nothing.
const SUFFIX_POS: Partial<Record<InflectionRule, PartOfSpeech>> = {
  "past-ed": "v",
  "past-ied": "v",
  "past-doubled": "v",
  ing: "v",
  "ing-e": "v",
  "ing-doubled": "v",
  "adverb-ly": "adj",
  "plural-s": "n",
  "plural-es": "n",
  "plural-ies": "n",
};

// The part of speech a lemma candidate's rule fixes, or null when the
// surface carries no such suffix.
export function pinnedPosForRule(rule: InflectionRule): PartOfSpeech | null {
  return SUFFIX_POS[rule] ?? null;
}

// pos-frequency.ts's single-letter codes, decoded back to a PartOfSpeech.
const FREQUENCY_CODE: Record<string, Exclude<PartOfSpeech, "phraseologicalUnit">> = {
  n: "n",
  v: "v",
  j: "adj",
  d: "adv",
  p: "pn",
};

// A sense's place in its headword's measured order, or null when that
// headword carries no row (RL-43) — never a rank for phraseologicalUnit,
// which pos-frequency.ts never scores.
function frequencyRank(order: string | undefined, pos: PartOfSpeech): number | null {
  if (!order) return null;
  for (let i = 0; i < order.length; i++) {
    if (FREQUENCY_CODE[order[i]] === pos) return i;
  }
  return null;
}

// RL-47's suffix clause outranks both: the typed form already told the
// reader which category to expect, so a sense carrying it leads whether or
// not SUBTLEX ever scored that headword. A lemma with no sense in the
// pinned category leaves both flags false and falls through unchanged.
function compareSenses(order: string | undefined, pinnedPos: PartOfSpeech | null, a: Sense, b: Sense): number {
  if (pinnedPos) {
    const aPinned = a.pos === pinnedPos;
    const bPinned = b.pos === pinnedPos;
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
  }
  const rankA = frequencyRank(order, a.pos);
  const rankB = frequencyRank(order, b.pos);
  if (rankA !== null && rankB !== null) return rankA - rankB;
  if (rankA !== null) return -1;
  if (rankB !== null) return 1;
  return POS_RANK[a.pos] - POS_RANK[b.pos];
}

// 34 of the 64,258 entries carry "." as their whole definition — a block
// drawn open onto a bare period is worse than no block at all, so it
// collapses to no definition here, the one place both the build and the
// runtime read a sense from.
function meaningfulDefinition(definition: string | null): string | null {
  return definition !== null && definition.trim() === "." ? null : definition;
}

function senseFromEntry(entry: RawEntry): Sense {
  const [, pos, ipa, translations, definition] = entry;
  return { pos, ipa, translations, definition: meaningfulDefinition(definition) };
}

export function buildIndex(payload: DictionaryPayload): DictionaryIndex {
  const entries = payload.entries;
  const byHeadword = new Map<string, number[]>();

  entries.forEach((entry, offset) => {
    const key = normaliseHeadword(entry[0]);
    const offsets = byHeadword.get(key);
    if (offsets) offsets.push(offset);
    else byHeadword.set(key, [offset]);
  });

  const sortedHeadwords = Array.from(byHeadword.keys()).sort();

  return { entries, byHeadword, sortedHeadwords };
}

// A headword is a group of senses, never a row: every entry sharing a
// normalised headword answers together, ordered by how often each part of
// speech is really used (RL-43) where pos-frequency.ts has a row for it,
// POS_RANK otherwise — unless pinnedPos names a category the group itself
// carries, in which case that category's senses lead (RL-47).
export function groupFor(
  index: DictionaryIndex,
  normalisedHeadword: string,
  pinnedPos: PartOfSpeech | null = null,
): SenseGroup | null {
  const offsets = index.byHeadword.get(normalisedHeadword);
  if (!offsets) return null;
  const order = POS_FREQUENCY_ORDER.get(normalisedHeadword);
  const senses = offsets
    .map((offset) => senseFromEntry(index.entries[offset]))
    .sort((a, b) => compareSenses(order, pinnedPos, a, b));
  return { headword: normalisedHeadword, senses };
}
