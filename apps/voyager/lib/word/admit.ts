import { normaliseHeadword } from "@/lib/dictionary/format";

// One token, lowercase, `'` and `-` allowed inside a word but not alone: the
// shape the shipped index's own headwords already have (`check-admission.ts`
// measures 42,595 of 58,944, 72.3%). Everything else — a sentence, a digit,
// punctuation meant to break out of SQL or HTML — never reaches the model.
const WORD_SHAPE = /^[a-z][a-z'-]{1,31}$/;
const MAX_HYPHENS = 2;
const MIN_LETTERS = 2;

// RL-44's half of the portal that replaces "is it in the asset": pure, so a
// caller can reject text before a single byte reaches the network or the
// database.
export function admitWord(raw: string): string | null {
  const word = normaliseHeadword(raw);
  // normaliseHeadword forgives a dictionary lookup wrapped in stray
  // punctuation by trimming it off the ends — the leniency a reader's typo
  // deserves. A caller feeding this gate does not: `<script>` normalises to
  // the real word "script", so a raw string that lost characters to that
  // trim never had this shape to begin with, and is refused as typed.
  if (word !== raw.trim().toLowerCase()) return null;
  if (!WORD_SHAPE.test(word)) return null;
  if ((word.match(/-/g) ?? []).length > MAX_HYPHENS) return null;
  if ((word.match(/[a-z]/g) ?? []).length < MIN_LETTERS) return null;
  return word;
}
