import { sql } from "drizzle-orm";
import { pgPolicy, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import { goalsSchema } from "./_schema";

// Where a derived fact is read from, and what one row of it is worth. The
// catalogue is the app's configuration, the same for everyone: no `user_id`,
// read-only to `authenticated`, and a second source is one INSERT (RNP-10).
export const evidenceSources = goalsSchema.table(
  "evidence_sources",
  {
    id: uuid().primaryKey().defaultRandom(),
    // What the reader for this source is registered under, in code.
    key: text().notNull().unique(),
    // A message-catalogue key, never a sentence: the interface is Spanish (RNP-01).
    labelKey: text().notNull(),
    unit: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    // Configuration everyone reads and nobody writes. RLS is enabled and not
    // forced, so the migration's own seed row still lands as the owner.
    pgPolicy("evidence_sources_select_all", {
      for: "select",
      to: authenticatedRole,
      using: sql`true`,
    }),
  ],
);

export type EvidenceSource = typeof evidenceSources.$inferSelect;
export type NewEvidenceSource = typeof evidenceSources.$inferInsert;
