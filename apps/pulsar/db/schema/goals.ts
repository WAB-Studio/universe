import { sql } from "drizzle-orm";
import { check, date, pgPolicy, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";

import { goalsSchema } from "./_schema";

// A name, a horizon and one measure. The measure itself is a sum over facts,
// never a column: these two only say what that sum is called and counted in.
export const goals = goalsSchema.table(
  "goals",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    name: text().notNull(),
    horizon: date().notNull(),
    // Null until the first commitment that measures something is created: the
    // new-goal screen asks for the name and the horizon alone.
    measureName: text(),
    measureUnit: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A measure with no unit is not a measure. Both null or both set.
    check(
      "goals_measure_paired",
      sql`(${t.measureName} is null) = (${t.measureUnit} is null)`,
    ),
    // `authUid` is `(select auth.uid())`: evaluated once per query, not once per row.
    pgPolicy("goals_select_self", {
      for: "select",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy("goals_insert_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${authUid} = ${t.userId}`,
    }),
    // The grant narrows this to the measure pair; `using` alone would let a
    // caller hand their goal to someone else's id.
    pgPolicy("goals_update_self", {
      for: "update",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
      withCheck: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy("goals_delete_self", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
  ],
);

export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
