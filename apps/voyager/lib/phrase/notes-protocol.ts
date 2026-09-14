import { z } from "zod";

import { admitWord } from "@/lib/word/admit";

// Shared with the route handler and the check script, so the body a caller
// sends is exactly the body the handler accepts — one schema, not two
// hand-kept in sync. No `server-only` here: `admitWord` carries none either
// (docs/TRAPS.md, "server-only resolves under Next and nowhere else").

export const NOTES_ENDPOINT = "/api/phrase/notes";

export const notesRequestSchema = z.object({
  source: z.string().min(1).max(200),
  translation: z.string().min(1).max(200),
});
export type NotesRequest = z.infer<typeof notesRequestSchema>;

export const phraseNoteSchema = z.object({
  term: z.string().min(1).max(64),
  note: z.string().min(1).max(280),
});
export type PhraseNoteAnswer = z.infer<typeof phraseNoteSchema>;

export const notesResponseSchema = z.object({
  notes: z.array(phraseNoteSchema).max(3),
});
export type NotesResponse = z.infer<typeof notesResponseSchema>;

const MAX_CHARS = 200;
const MIN_TOKENS = 2;
// Shared by both strings: the source is a sentence of real words, and a
// translation this long is already past what one note-worthy sentence
// looks like — nothing in the contract asks for two different ceilings.
const MAX_PHRASE_TOKENS = 12;

// Whitespace and `.,;:'"?!` both break a token — this is the one place a
// contraction or a quoted word costs the gate: "don't" splits into "don"
// and "t", and "t" never passes `admitWord`. A sentence, not a word list, is
// what this route is for, and the reader's own translation still fails it
// the same way a word list would.
const SEPARATOR = /[\s.,;:'"?!]+/;

export function tokenisePhrase(s: string): string[] {
  return s.split(SEPARATOR).filter(Boolean);
}

// The translation is Spanish prose, not a word list, so `admitWord` never
// runs on it — it would refuse "año" and "¿qué" as readily as it refuses
// `<script>`. Its own shape is looser on the alphabet (accents, ñ, ü, the
// opening ¿¡, and the quoting marks «»""''… and – a Spanish sentence sets in)
// and tighter nowhere `admitWord` already is not: no `<`, no `>`, no CJK or
// kana, no fullwidth Latin. `À-ÖØ-öø-ÿ` is the Latin-1 accented block end to
// end; it excludes `×` and `÷`, the two symbols that sit in its gaps, and it
// excludes every fullwidth or CJK codepoint outright — they are a different
// block, not a different case of the same letter.
const TRANSLATION_SHAPE = /^[A-Za-zÀ-ÖØ-öø-ÿ¿¡.,;:'"?!—–«»…""''\s-]+$/;

// A translation is one line of prose: nothing a reader types has any
// business carrying a C0 control or DEL. Tested on the raw string, before
// `collapseWhitespace` ever runs — that call folds `\n`, `\r` and a tab into
// a plain space, which would launder every one of them past this check the
// same way skipping straight to a trimmed shape test laundered `<script>`
// into `script` (docs/TRAPS.md).
const CONTROL_CHAR = /[\u0000-\u001F\u007F]/;

// Only the whitespace collapse `normaliseHeadword` also opens with — never
// its `\p{L}` trim, the step that laundered `<script>` into the real word
// `script` (docs/TRAPS.md, "Normalising before you check the shape launders
// markup into a real word"). Checking `TRANSLATION_SHAPE` against this
// output is safe because nothing here can turn a character the shape
// refuses into one it accepts.
function collapseWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/**
 * Admits Spanish prose, never a lookup key. Returns the translation's own
 * tokens on success or `null` on any failure. A fullwidth homoglyph such as
 * `ｆｏｘ` is refused as typed rather than folded to `fox` by NFKC and
 * accepted — the same choice `admitWord` already makes by never normalising
 * a shape check's input, only its own trim. NFC is the one normalisation
 * this function does run: it composes a combining accent onto its base
 * letter (`e` + U+0301 becomes the same `é` a reader who typed the
 * precomposed form already sent), a canonical equivalence that never folds
 * a fullwidth or CJK codepoint into a different block the way NFKC would.
 */
export function admitTranslation(translation: string): string[] | null {
  const normalised = translation.normalize("NFC");
  if (CONTROL_CHAR.test(normalised)) return null;

  const collapsed = collapseWhitespace(normalised);
  if (!TRANSLATION_SHAPE.test(collapsed)) return null;

  const tokens = tokenisePhrase(collapsed);
  if (tokens.length < MIN_TOKENS || tokens.length > MAX_PHRASE_TOKENS) return null;

  return tokens;
}

/**
 * The gate this route's first paragraph promises: a closed shape, never a
 * lookup, so nothing reaches the cache or the model that is not already a
 * short sentence of real words. Returns the source's own tokens on success
 * — the caller's one pass over them, reused for the hints below rather than
 * re-split — or `null` on any failure, in the order the contract lists.
 */
export function admitPhrase(source: string, translation: string): string[] | null {
  if (source.length > MAX_CHARS || translation.length > MAX_CHARS) return null;

  const sourceTokens = tokenisePhrase(source);
  if (sourceTokens.length < MIN_TOKENS) return null;

  for (const token of sourceTokens) {
    if (admitWord(token) === null) return null;
  }

  if (/\d/.test(source) || /\d/.test(translation)) return null;
  if (sourceTokens.length > MAX_PHRASE_TOKENS) return null;

  if (admitTranslation(translation) === null) return null;

  return sourceTokens;
}
