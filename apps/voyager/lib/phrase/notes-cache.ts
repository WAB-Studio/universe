import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { PhraseNoteAnswer } from "@/lib/phrase/notes-protocol";

// Case and outer/inner whitespace never change what was asked, so they must
// not change the cache key either — the same fold `translate/route.ts`
// already uses to compare a source against its own echo.
function foldPhrase(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

// The source and its translation together, never the source alone: a
// different translation can lead the model to a different term (`black
// minorca` reads differently depending on what came back). `␟` — the
// Unicode "unit separator" picture — joins the two so a source ending where
// a translation begins never collides with the reverse split. The clear
// phrase itself is never the row's key or its value: only this digest is.
export function phraseHash(source: string, translation: string): string {
  const joined = `${foldPhrase(source)}␟${foldPhrase(translation)}`;
  return createHash("sha256").update(joined).digest("hex");
}

type CachedRow = { notes: PhraseNoteAnswer[] };

/** The one round trip the hot path pays. A miss returns `null`, never throws. */
export async function readCachedNotes(hash: string): Promise<PhraseNoteAnswer[] | null> {
  const [row] = await db.execute<CachedRow>(sql`
    select notes from reading.phrase_notes where phrase_hash = ${hash}
  `);
  return row ? row.notes : null;
}

/**
 * Written once, on an accepted model answer alone — zero notes is still an
 * accepted answer and still gets a row, so a repeat of a sentence with
 * nothing worth noting also skips the model on its second reading.
 * `on conflict do nothing`: two cold readers racing the same phrase both pay
 * the call, and whichever insert lands first is the one every later reader
 * sees (module 5's own trade for photos, `writeCachedText`).
 */
export async function writeCachedNotes(
  hash: string,
  model: string,
  notes: PhraseNoteAnswer[],
): Promise<void> {
  await db.execute(sql`
    insert into reading.phrase_notes (phrase_hash, notes, model)
    values (${hash}, ${JSON.stringify(notes)}::jsonb, ${model})
    on conflict (phrase_hash) do nothing
  `);
}
