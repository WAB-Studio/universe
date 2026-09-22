import { sql } from "drizzle-orm";
import { check, date, pgPolicy, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";

import { goalsSchema } from "./_schema";
import { goals } from "./goals";

// A stretch of a goal with an aim of its own. Phases may touch or leave gaps;
// nothing here says they tile the horizon.
export const phases = goalsSchema.table(
  "phases",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    goalId: uuid()
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    aim: text().notNull(),
    startsOn: date().notNull(),
    endsOn: date().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A one-day phase is legal; a backwards one is not.
    check("phases_ends_on_after_starts_on", sql`${t.endsOn} >= ${t.startsOn}`),
    pgPolicy("phases_select_self", {
      for: "select",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy("phases_insert_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy("phases_delete_self", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
  ],
);

export type Phase = typeof phases.$inferSelect;
export type NewPhase = typeof phases.$inferInsert;
