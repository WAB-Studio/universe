import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgPolicy,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";

import { goalsSchema } from "./_schema";
import { evidenceSources } from "./evidence-sources";
import { goals } from "./goals";

// What counts, how often, and what satisfies it. Retired, never deleted: the
// only column the grant layer lets anyone update is `retired_at`, so a week
// already lived keeps the shape it was lived in.
export const commitments = goalsSchema.table(
  "commitments",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    goalId: uuid()
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    name: text().notNull(),
    cadenceKind: text({
      enum: [
        "daily",
        "weekdays",
        "times_per_week",
        "every_n_days",
        "times_per_month",
      ],
    }).notNull(),
    // How many, or how far apart, for the three kinds that count.
    cadenceN: integer(),
    // ISO weekdays, Monday = 1 and Sunday = 7. The design's week runs
    // lunes→domingo and `weekOf` returns it in that order, so the only place
    // these are read needs no translation.
    cadenceWeekdays: smallint().array(),
    satisfaction: text({ enum: ["tap", "quantity", "evidence"] }).notNull(),
    targetQuantity: integer(),
    // The unit belongs here, never to the fact that repeats it.
    unit: text(),
    // Which catalogue row the derived fact is read from. Nothing here names a
    // particular source: that is the row's own business (RNP-10).
    sourceId: uuid().references(() => evidenceSources.id),
    // How much of that source's unit satisfies one day.
    threshold: integer(),
    retiredAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The day's screen reads the live commitments of one person.
    index("commitments_user_id_retired_at_idx").on(t.userId, t.retiredAt),
    // A CASE, not an equality between two predicates: `array_length` on an
    // empty array is NULL, and a CHECK that evaluates to NULL admits the row.
    // `'{}'` is refused on both sides of the case — a week of no days for
    // `weekdays`, a column with no business being set for every other kind.
    check(
      "commitments_weekdays_for_weekdays",
      sql`case when ${t.cadenceKind} = 'weekdays' then coalesce(array_length(${t.cadenceWeekdays}, 1), 0) > 0 else ${t.cadenceWeekdays} is null end`,
    ),
    // A null array passes: whether it may be null at all is the CHECK above,
    // and that one is total.
    check(
      "commitments_weekdays_iso_range",
      sql`${t.cadenceWeekdays} <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]`,
    ),
    // The three below are equalities between two predicates: the column set is
    // not merely allowed by the kind, it is required by it and refused by the
    // rest. Every right-hand side is total — an `is not null` first, so a null
    // column reads false and never NULL.
    check(
      "commitments_n_for_counted_kinds",
      sql`(${t.cadenceKind} in ('times_per_week', 'every_n_days', 'times_per_month')) = (${t.cadenceN} is not null and ${t.cadenceN} > 0)`,
    ),
    check(
      "commitments_quantity_for_quantity",
      sql`(${t.satisfaction} = 'quantity') = (${t.targetQuantity} is not null and ${t.unit} is not null)`,
    ),
    check(
      "commitments_source_for_evidence",
      sql`(${t.satisfaction} = 'evidence') = (${t.sourceId} is not null and ${t.threshold} is not null and ${t.threshold} >= 1)`,
    ),
    pgPolicy("commitments_select_self", {
      for: "select",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy("commitments_insert_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${authUid} = ${t.userId}`,
    }),
    // The grant narrows this to `retired_at`; `using` alone would let a caller
    // hand their commitment to someone else's id.
    pgPolicy("commitments_update_self", {
      for: "update",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
      withCheck: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy("commitments_delete_self", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
  ],
);

export type Commitment = typeof commitments.$inferSelect;
export type NewCommitment = typeof commitments.$inferInsert;
