import { sql } from "drizzle-orm";
import { pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { EvidenceReader } from "./types";

/**
 * A read-only reference to `apps/voyager`'s `reading.lookups`
 * (apps/voyager/db/schema/lookups.ts), narrowed to the four columns this
 * reader needs. Declared here and never exported from `db/schema/index.ts`:
 * drizzle-kit's diff for this app never sees this table, so it never tries
 * to create, alter or drop it (RNP-10). `apps/voyager` owns that table, its
 * migration and its policies; this file only names enough of its shape to
 * read from it.
 */
const reading = pgSchema("reading");

const lookups = reading.table("lookups", {
  userId: uuid().notNull(),
  at: timestamp({ withTimezone: true }).notNull(),
  receivedAt: timestamp({ withTimezone: true }).notNull(),
  text: text().notNull(),
});

/**
 * One search, one row: `Meta.dc.html` draws «1 búsqueda · diccionario»
 * (the threshold taken 2026-09-22), so a day's quantity is a plain count.
 */
const UNIT = "searches";
const LABEL_KEY = "sources.readingLookups";

/**
 * One statement: how many searches landed on each civil day of `zone`,
 * between `from` and `to` inclusive. Nothing here filters by `personId` —
 * `apps/voyager`'s own `lookups_select_self` policy is what narrows the rows
 * to the caller's own (RP-10, RNP-05), because `tx` arrives already settled
 * to `search_path = 'reading, public'` and `role = authenticated` by
 * `withReadingDb`. A reader that repeated that filter in SQL would still be
 * correct; it would also read as the reason the row is safe, when the reason
 * is the policy underneath it.
 */
export const readReadingLookups: EvidenceReader = async ({ from, to, zone, tx }) => {
  const civilDay = sql<string>`(${lookups.at} at time zone ${zone})::date`;

  // A CTE, not a repeated expression: binding `zone` a second time in the
  // outer query's GROUP BY would give Postgres a second, distinct parameter
  // node for the same value, and it refuses to group by an expression it
  // cannot prove equals the one in SELECT. Grouping by the CTE's own column
  // is a plain column reference, so no such proof is ever needed.
  const civilDays = tx
    .$with("civil_days")
    .as(
      tx
        .select({ day: civilDay.as("day") })
        .from(lookups)
        .where(sql`${civilDay} between ${from} and ${to}`),
    );

  const rows = await tx
    .with(civilDays)
    .select({ day: civilDays.day, quantity: sql<number>`count(*)::int` })
    .from(civilDays)
    .groupBy(civilDays.day)
    .orderBy(civilDays.day);

  return rows.map((row) => ({
    day: row.day,
    quantity: row.quantity,
    unit: UNIT,
    labelKey: LABEL_KEY,
  }));
};
