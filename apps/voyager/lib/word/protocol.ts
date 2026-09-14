import { z } from "zod";

// Shared with the two route handlers, so the body a client `fetch` sends is
// exactly the body each handler accepts — one schema, not two hand-kept in
// sync. Loaded by client components too, so no `server-only` here
// (docs/TRAPS.md, "server-only resolves under Next and nowhere else").

// Declared above the schemas: `photoResponseSchema` reads it at module
// evaluation time, so it must not sit in the temporal dead zone.
export const PHOTO_ENDPOINT = "/api/word/photo";

export const photoRequestSchema = z.object({
  headword: z.string().min(1).max(64),
});
export type PhotoRequest = z.infer<typeof photoRequestSchema>;

export const photoResponseSchema = z.object({
  // A same-origin path, never an absolute URL: see `toWordPhoto`. `next/image`
  // refuses an absolute URL whose host is not in `remotePatterns`.
  url: z.string().startsWith(`${PHOTO_ENDPOINT}?`),
  width: z.int().positive(),
  height: z.int().positive(),
  author: z.string().min(1),
  licence: z.enum(["by", "by-sa", "cc0", "pdm"]),
  licenceUrl: z.url(),
  sourceUrl: z.url(),
});
export type WordPhoto = z.infer<typeof photoResponseSchema>;

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
