import { normaliseHeadword, type PartOfSpeech } from "@/lib/dictionary/format";
import { lemmaCandidates, type InflectionRule } from "@/lib/dictionary/inflect";
import { groupFor, type DictionaryIndex, type SenseGroup } from "@/lib/dictionary/index-build";

// RL-45: a lemma the dictionary carries but barely — too few translations to
// trust alone, and either more than one sense to pick from or no definition
// to fall back on. Widened by the user 2026-09-11 from "≤3 translations and
// ≥2 senses" (1,885 of 58,944, 3.2%), which missed `stern` and everything
// with no definition at all.
//
// Measured over the shipped asset: this rule catches 9,523 of 59,253 lemmas
// (16.1%). Dropping the sense-or-no-definition floor entirely — "≤4
// translations" alone — jumps to 90.0%: the floor is what keeps this a
// correction of the thin cases, not a second call on nearly every word.
export function isThinAnswer(group: SenseGroup): boolean {
  const translationCount = group.senses.reduce((total, sense) => total + sense.translations.length, 0);
  const hasNoDefinition = group.senses.every((sense) => sense.definition === null);
  return translationCount <= 4 && (group.senses.length >= 2 || hasNoDefinition);
}

// The category a rule's own ending promises the target lemma will carry.
// A rule absent here (identity, irregular, every plain-plural family member
// left out on purpose) promises nothing on its own and never disagrees.
const RULE_IMPLIES_POS: Partial<Record<InflectionRule, PartOfSpeech>> = {
  ing: "v",
  "ing-e": "v",
  "ing-doubled": "v",
  "past-ed": "v",
  "past-ied": "v",
  "past-doubled": "v",
  "adverb-ly": "adj",
  comparative: "adj",
  superlative: "adj",
  "plural-s": "n",
  "plural-es": "n",
  "plural-ies": "n",
  possessive: "n",
};

// RL-45's surgical widening: a reader typing "swishing" wanted the verb
// `swish` never lists, and `isThinAnswer` alone never notices — `swish`
// carries one sense, `thin=false`. True only when the rule's own ending
// implies a category and the lemma carries none of it; the caller is the
// one that decides whether the inflection actually moved the reader here,
// since a lemma the surface names on its own is owed nothing.
// Catches 9 of a real reader's 45 word lookups, one more than `isThinAnswer`
// alone: `swishing`. A first, uncorrected draft of this rule caught 12 and
// three were false positives — surfaces the dictionary already answers as
// their own headword.
export function isInflectionDisagreement(group: SenseGroup, rule: InflectionRule): boolean {
  const implied = RULE_IMPLIES_POS[rule];
  return implied !== undefined && !group.senses.some((sense) => sense.pos === implied);
}

// The client names a surface and a rule; the server never takes that pair
// on faith, since it never saw the keystroke that produced it. True only
// when `lemmaCandidates` really offers this exact rule for this exact
// surface toward this exact headword, and the surface itself carries no
// entry of its own — a surface the dictionary already answers (`swiftly`
// next to `swift`, `buried` next to `bury`) was never really moved
// anywhere, whatever rule also happens to apply to it.
export function inflectionReallyMovedReader(
  index: DictionaryIndex,
  headword: string,
  surface: string,
  rule: InflectionRule,
): boolean {
  const normalisedSurface = normaliseHeadword(surface);
  if (normalisedSurface === headword) return false;
  if (groupFor(index, normalisedSurface) !== null) return false;
  return lemmaCandidates(surface).some((candidate) => candidate.lemma === headword && candidate.rule === rule);
}
