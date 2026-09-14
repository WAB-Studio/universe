import { text, timestamp } from "drizzle-orm/pg-core";

import { reading } from "./_schema";

// One row per word the unlisted-word route (RL-44, RL-47) has ever answered:
// a word the dictionary carries no entry for at all, or a form of one it
// does. `lemma`/`rule` are null for the first case and set for the second —
// the same InflectionRule shape `lookupWord` already returns. Not a
// reader's record — RLS is on with no policy, owner role only.
export const wordAnswers = reading.table("word_answers", {
  word: text().primaryKey(),
  lemma: text(),
  rule: text(),
  translations: text().array().notNull(),
  definition: text(),
  exampleEn: text().notNull(),
  exampleEs: text().notNull(),
  model: text().notNull(),
  resolvedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type WordAnswerRow = typeof wordAnswers.$inferSelect;
export type NewWordAnswerRow = typeof wordAnswers.$inferInsert;
