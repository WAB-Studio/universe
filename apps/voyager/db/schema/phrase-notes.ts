import { jsonb, text, timestamp } from "drizzle-orm/pg-core";

import { reading } from "./_schema";

export type PhraseNote = { term: string; note: string };

// One row per phrase the notes route (RL-46) has ever answered, keyed by a
// sha-256 hash of the normalised phrase — the phrase itself is never stored,
// only what it hashed to and the notes it earned. Not a reader's record —
// RLS is on with no policy, owner role only.
export const phraseNotes = reading.table("phrase_notes", {
  phraseHash: text().primaryKey(),
  notes: jsonb().notNull().$type<PhraseNote[]>(),
  model: text().notNull(),
  resolvedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type PhraseNoteRow = typeof phraseNotes.$inferSelect;
export type NewPhraseNoteRow = typeof phraseNotes.$inferInsert;
