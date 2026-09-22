import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgPolicy,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";

import { commitments } from "./commitments";
import { goalsSchema } from "./_schema";
import { goals } from "./goals";
import { oneOffs } from "./one-offs";

// Something that happened. Written once, removed whole or not at all: there is
// no UPDATE grant on this table to any role, and no update policy either.
export const facts = goalsSchema.table(
  "facts",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    commitmentId: uuid().references(() => commitments.id, {
      onDelete: "cascade",
    }),
    oneOffId: uuid().references(() => oneOffs.id, { onDelete: "cascade" }),
    goalId: uuid().references(() => goals.id, { onDelete: "cascade" }),
    // The day it happened, in the person's own zone, decided before the insert.
    day: date().notNull(),
    // The moment it was written, on the server's clock. Never the same column
    // as the day above, and never collapsed into it.
    writtenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    quantity: integer(),
    note: text(),
  },
  (t) => [
    // The day's screen reads one person's facts for one day.
    index("facts_user_id_day_idx").on(t.userId, t.day),
    // A line, not a journal entry.
    check("facts_note_length", sql`length(${t.note}) <= 280`),
    // Exactly one of the two, never both and never neither: a fact satisfies
    // something. A fact that belongs to nothing has no code asking for it.
    check(
      "facts_one_subject",
      sql`(${t.commitmentId} is null) <> (${t.oneOffId} is null)`,
    ),
    pgPolicy("facts_select_self", {
      for: "select",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy("facts_insert_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${authUid} = ${t.userId}`,
    }),
    // Undoing a tap is a delete of the whole row: the only way a fact leaves.
    pgPolicy("facts_delete_self", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
  ],
);

export type Fact = typeof facts.$inferSelect;
export type NewFact = typeof facts.$inferInsert;
