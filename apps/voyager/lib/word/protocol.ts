import { z } from "zod";

import type { InflectionRule } from "@/lib/dictionary/inflect";

// Shared with the text route handler, so the body a client `fetch` sends is
// exactly the body the handler accepts — one schema, not two hand-kept in
// sync. Loaded by client components too, so no `server-only` here
// (docs/TRAPS.md, "server-only resolves under Next and nowhere else").

// zod's `enum` needs its own literal array; `satisfies` is what keeps this
// list from drifting away from `InflectionRule` unnoticed.
const INFLECTION_RULES = [
  "identity",
  "irregular",
  "plural-s",
  "plural-es",
  "plural-ies",
  "past-ed",
  "past-ied",
  "past-doubled",
  "ing",
  "ing-e",
  "ing-doubled",
  "comparative",
  "superlative",
  "adverb-ly",
  "possessive",
] as const satisfies readonly InflectionRule[];

export const textRequestSchema = z.object({
  headword: z.string().min(1).max(64),
  needDefinition: z.boolean(),
  // RL-45's flexion portero: the surface the reader actually typed and the
  // rule the client believes reached `headword` from it. The route never
  // takes this pair on faith — it re-derives the candidates from `surface`
  // itself before trusting the rule. Both absent is a plain lookup.
  surface: z.string().min(1).max(64).optional(),
  rule: z.enum(INFLECTION_RULES).optional(),
});
export type TextRequest = z.infer<typeof textRequestSchema>;

export const textResponseSchema = z.object({
  definition: z.string().min(1).nullable(),
  example: z.object({
    en: z.string().min(1),
    es: z.string().min(1),
  }),
  // RL-45: null for an answer the dictionary was never thin on. A thin one
  // asked over the network answers an array — empty if none came back — and
  // is never asked again (`word-texts.ts`'s `translationsAsked`).
  // Absent parses as null rather than throwing: `use-decoration.ts` parses
  // with `.parse`, so a body cached before this field existed would take the
  // generated text down with it.
  translations: z.array(z.string().min(1)).nullable().default(null),
});
export type WordText = z.infer<typeof textResponseSchema>;

export const TEXT_ENDPOINT = "/api/word/text";
