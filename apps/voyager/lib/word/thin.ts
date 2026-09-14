import type { SenseGroup } from "@/lib/dictionary/index-build";

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
