import { suggestCorrection } from "./edit-distance";
import { normaliseHeadword } from "./format";
import { groupFor, pinnedPosForRule, type DictionaryIndex, type SenseGroup } from "./index-build";
import { lemmaCandidates, type InflectionRule } from "./inflect";
import { IRREGULAR_FORMS } from "./irregular-forms";

export type InflectedHit = {
  surface: string;
  lemma: string;
  rule: InflectionRule;
  group: SenseGroup;
};

export type WordAnswer = {
  query: string;
  exact: SenseGroup | null;
  viaInflection: readonly InflectedHit[];
  // RL-28: headwords one edit from the query, computed only when the query
  // hit neither of the two fields above — an answered query never needed a
  // correction, so this stays empty rather than costing a lookup nobody reads.
  correction: readonly string[];
};

const MAX_INFLECTED_HITS = 3;

// The only one-letter normalised forms the dictionary means to answer: the
// indefinite article and the pronoun "I" (which normalises to "i"). Every
// other one-letter key in the index — "b", "p", "c", "e", "o", "s", "u",
// "x", "y", "4" — is an abbreviation's stripped period, a bare letter-name
// entry or a suffix list, not a headword a reader typing one key meant to
// reach.
const ANSWERABLE_SINGLE_CHAR_HEADWORDS: ReadonlySet<string> = new Set(["a", "i"]);

function isAnswerableHeadword(normalised: string): boolean {
  return normalised.length !== 1 || ANSWERABLE_SINGLE_CHAR_HEADWORDS.has(normalised);
}

// Stripping "-er"/"-r" off any word that ends that way, then checking the
// result is a headword, catches a noun or a pronoun whose stem happens to
// coincide with a real word: "her" -> "he", "beer" -> "be"/"bee", "baker"
// -> "bake" all pass that test despite naming no comparative at all. Only
// comparative and superlative run this second check, on the group already
// fetched for the exists test above, so it costs no further lookup: a
// grammatical category (adj) the group must carry for the guess to stand.
function isImplausible(rule: InflectionRule, group: SenseGroup): boolean {
  if (rule !== "comparative" && rule !== "superlative") return false;
  return !group.senses.some((sense) => sense.pos === "adj");
}

// Every lemma some surface in the table already governs — "run" via "ran",
// "be" via "was"/"were"/"been" — so a regular rule's own guess toward one
// of these can be told apart from a guess toward a lemma the table never
// touches at all.
const IRREGULAR_TABLE_LEMMAS: ReadonlySet<string> = new Set(Array.from(IRREGULAR_FORMS.values()).flat());

const PAST_TENSE_RULES: ReadonlySet<InflectionRule> = new Set(["past-ed", "past-ied", "past-doubled"]);
const PLURAL_RULES: ReadonlySet<InflectionRule> = new Set(["plural-s", "plural-es", "plural-ies"]);

// A regular suffix rule and the irregular table can each name a lemma for
// the same surface, and disagree: "bed" strips to "be" by -ed, but "be"'s
// real past is "was"/"were" — a form no suffix rule here ever produces.
// Only the rule families whose category the table actually replaces are
// checked, each against the matching sense: a past-tense guess against a
// lemma the table governs as a verb, or a plural guess against one it
// governs as a noun. "running" -> "run" is untouched: -ing has no
// irregular family to lose to, so "run" carrying a past-tense entry
// ("ran") never enters this check.
//
// English spells the noun plural and the third-person-singular present
// with the same "-s", so a plural guess cannot be rejected on the target
// carrying a noun sense alone: "leave" carries both, and rejecting it on
// the noun sense is what stopped "leaves" from ever offering "leave". The
// plural guess is only ever wrong here when the table governs the lemma
// as a noun and nothing else — no verb sense for the "-s" to be a
// third-person-singular of — which is the case the branch was written for.
function isOverriddenByIrregularTable(rule: InflectionRule, lemma: string, group: SenseGroup): boolean {
  if (!IRREGULAR_TABLE_LEMMAS.has(lemma)) return false;
  if (PAST_TENSE_RULES.has(rule)) return group.senses.some((sense) => sense.pos === "v");
  if (PLURAL_RULES.has(rule)) {
    return group.senses.some((sense) => sense.pos === "n") && !group.senses.some((sense) => sense.pos === "v");
  }
  return false;
}

// The exact headword when the index carries it, offered alongside every
// plausible inflection candidate — never instead of them: a reader who
// typed "left" gets its own entry and the offer of "leave" beneath it, and
// a reader who typed "bed" gets its own entry and nothing else, because
// `b` fails `isAnswerableHeadword` and `be`'s regular "-ed" guess loses to
// the irregular table's own "was"/"were".
export function lookupWord(index: DictionaryIndex, query: string): WordAnswer {
  const normalised = normaliseHeadword(query);
  if (normalised.length === 0) return { query, exact: null, viaInflection: [], correction: [] };
  if (!isAnswerableHeadword(normalised)) return { query, exact: null, viaInflection: [], correction: [] };

  const exact = groupFor(index, normalised);

  const viaInflection: InflectedHit[] = [];
  for (const candidate of lemmaCandidates(query)) {
    if (candidate.lemma === normalised) continue;
    if (!isAnswerableHeadword(candidate.lemma)) continue;
    // RL-47: the suffix that led here fixes a part of speech, so that
    // category's senses lead the lemma's own group when it carries one.
    const group = groupFor(index, candidate.lemma, pinnedPosForRule(candidate.rule));
    if (!group) continue;
    if (isImplausible(candidate.rule, group)) continue;
    if (isOverriddenByIrregularTable(candidate.rule, candidate.lemma, group)) continue;
    viaInflection.push({ surface: normalised, lemma: candidate.lemma, rule: candidate.rule, group });
    if (viaInflection.length === MAX_INFLECTED_HITS) break;
  }

  const correction = exact === null && viaInflection.length === 0 ? suggestCorrection(index, normalised) : [];

  return { query, exact, viaInflection, correction };
}

// Lowest index whose entry is not less than target, so a prefix's matches
// sit in one contiguous run starting here.
function lowerBound(sorted: readonly string[], target: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function suggest(index: DictionaryIndex, prefix: string, limit: number): string[] {
  const normalised = normaliseHeadword(prefix);
  if (normalised.length === 0 || limit <= 0) return [];

  const { sortedHeadwords } = index;
  const results: string[] = [];
  for (let i = lowerBound(sortedHeadwords, normalised); i < sortedHeadwords.length && results.length < limit; i++) {
    const headword = sortedHeadwords[i];
    if (!headword.startsWith(normalised)) break;
    // A one-letter headword lookupWord no longer answers is not a suggestion
    // either: offering "b" only to have the reader tap it and see nothing
    // change is worse than one fewer item in the list.
    if (!isAnswerableHeadword(headword)) continue;
    results.push(headword);
  }
  return results;
}

export function hasEntry(index: DictionaryIndex, text: string): boolean {
  const answer = lookupWord(index, text);
  return answer.exact !== null || answer.viaInflection.length > 0;
}
