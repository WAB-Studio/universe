import { boolean, text, timestamp } from "drizzle-orm/pg-core";

import { reading } from "./_schema";

// One row per headword the text route (RL-41, RL-42) has ever generated a
// definition or example for. Only an accepted model answer lands here: the
// route writes nothing on failure, so a bad day never blocks a retry. Not a
// reader's record — RLS is on with no policy, owner role only.
export const wordTexts = reading.table("word_texts", {
  headword: text().primaryKey(),
  definition: text(),
  exampleEn: text().notNull(),
  exampleEs: text().notNull(),
  model: text().notNull(),
  resolvedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  // RL-45's network translations for a thin entry, asked for once and cached
  // beside the example: null until asked, an empty array is a real "none".
  translations: text().array(),
  translationsAsked: boolean().notNull().default(false),
});

export type WordTextRow = typeof wordTexts.$inferSelect;
export type NewWordTextRow = typeof wordTexts.$inferInsert;
