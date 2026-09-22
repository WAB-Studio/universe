import { sql } from "drizzle-orm";
import { date, pgPolicy, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";

import { goalsSchema } from "./_schema";
import { goals } from "./goals";

// Something to do once. No day when it is not on a day yet, no goal when it
// belongs to none: a one-off with neither is still a whole one-off.
export const oneOffs = goalsSchema.table(
  "one_offs",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    goalId: uuid().references(() => goals.id, { onDelete: "cascade" }),
    name: text().notNull(),
    day: date(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy("one_offs_select_self", {
      for: "select",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy("one_offs_insert_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy("one_offs_delete_self", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
  ],
);

export type OneOff = typeof oneOffs.$inferSelect;
export type NewOneOff = typeof oneOffs.$inferInsert;
