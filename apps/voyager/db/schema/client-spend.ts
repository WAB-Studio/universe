import { sql } from "drizzle-orm";
import { check, date, integer, primaryKey, text } from "drizzle-orm/pg-core";

import { reading } from "./_schema";

// The per-caller half of the daily budget RL-44/RL-47 need on top of
// `model_spend`'s global one: one row per (day, client), `client` being a
// salted hash of the caller's IP, never the address itself. Bumped in a
// single `on conflict do update` before either route ever calls a paid
// provider — never after.
export const clientSpend = reading.table(
  "client_spend",
  {
    day: date().notNull(),
    client: text().notNull(),
    calls: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.client] }),
    check("client_spend_calls_non_negative", sql`${t.calls} >= 0`),
  ],
);

export type ClientSpendRow = typeof clientSpend.$inferSelect;
export type NewClientSpendRow = typeof clientSpend.$inferInsert;
