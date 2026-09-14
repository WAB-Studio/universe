import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgPolicy,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import { finances } from "./_schema";
import { accountStatements } from "./account-statements";
import { accounts } from "./accounts";
import { transactions } from "./transactions";

// One row per (movement, account leg): the reference that leg's own statement gave it, so a transfer
// read off either side's statement is recognised as the movement already recorded (RF-134). The
// statement is the unit a re-import replaces, not this row — `source_seq` only orders a leg inside
// the statement that named it; nothing here is itself the idempotency key of an import that does not
// exist yet (Deferred, Module 15). `transactions.external_ref` is untouched: it governs the app's own
// export/import round trip, a different key for a different source.
export const transactionSources = finances.table(
  "transaction_sources",
  {
    id: uuid().primaryKey().defaultRandom(),
    transactionId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    // Restrict, not cascade: an account with a recorded source stays recorded history, same as every
    // other reference to `accounts` a movement carries.
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    // Set null, not cascade: the statement that named this leg can be re-closed or removed without
    // taking the leg's own movement history with it.
    statementId: uuid().references(() => accountStatements.id, { onDelete: "set null" }),
    // The bank's own reference for this leg. Null when the issuer prints none for that row.
    sourceRef: text(),
    // The line's ordinal inside the statement that named it. Null once a real reference exists.
    sourceSeq: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A leg names at least one of the two ways a statement can identify it.
    check(
      "transaction_sources_ref_or_seq",
      sql`num_nonnulls(${table.sourceRef}, ${table.sourceSeq}) >= 1`,
    ),
    check("transaction_sources_ref_length", sql`length(${table.sourceRef}) <= 200`),
    // One source row per account leg of one movement — the invariant a re-import relies on.
    unique("transaction_sources_transaction_account_unique").on(
      table.transactionId,
      table.accountId,
    ),
    // The bank's reference is unique within the account that received it, when it gives one at all.
    uniqueIndex("transaction_sources_account_ref_unique")
      .on(table.accountId, table.sourceRef)
      .where(sql`${table.sourceRef} is not null`),
    // A statement's own line ordinals never repeat inside that statement.
    uniqueIndex("transaction_sources_statement_seq_unique")
      .on(table.statementId, table.sourceSeq)
      .where(sql`${table.sourceSeq} is not null`),
    // Readable and writable exactly when the leg's own account is — the scope is the account's.
    pgPolicy("transaction_sources_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select private.can_read_account(${table.accountId}))`,
    }),
    pgPolicy("transaction_sources_insert", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select private.can_write_account(${table.accountId}))`,
    }),
    pgPolicy("transaction_sources_delete", {
      for: "delete",
      to: authenticatedRole,
      using: sql`(select private.can_write_account(${table.accountId}))`,
    }),
    // No UPDATE policy: a source reference is replaced by deleting and re-inserting, never edited in place.
  ],
);

export type TransactionSource = typeof transactionSources.$inferSelect;
export type NewTransactionSource = typeof transactionSources.$inferInsert;
