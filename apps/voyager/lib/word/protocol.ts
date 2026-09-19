import { z } from "zod";

// Shared with the text route handler, so the body a client `fetch` sends is
// exactly the body the handler accepts — one schema, not two hand-kept in
// sync. Loaded by client components too, so no `server-only` here
// (docs/TRAPS.md, "server-only resolves under Next and nowhere else").

export const textRequestSchema = z.object({
  headword: z.string().min(1).max(64),
  needDefinition: z.boolean(),
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
