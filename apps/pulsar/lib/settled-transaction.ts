import { settleSessionSql } from "@repo/supabase-auth/settle";
import type { SQL } from "drizzle-orm";

export type VerifiedSession = { claims: Record<string, unknown> };

/**
 * The guard-and-settle body every door to this app's tables runs before a
 * query (RNP-05): throws before any connection is taken when there is no
 * session, otherwise opens the caller's own transaction and settles it with
 * `settleSessionSql` before running `fn`.
 *
 * No `next/headers`, no `server-only`, no `@/db/client`: `begin` opens the
 * caller's own transaction and `run` executes a statement on it, so
 * `lib/session.ts` passes drizzle's `db.transaction`/`tx.execute` and a
 * script driving its own `postgres` connection passes its own — both call
 * this one function, never a copy of it, which is what lets a mutation here
 * be caught wherever it is called from.
 */
export async function withSettledTransaction<Tx, T>(
  session: VerifiedSession | null,
  label: string,
  searchPath: string,
  begin: (fn: (tx: Tx) => Promise<T>) => Promise<T>,
  run: (tx: Tx, statement: SQL) => Promise<unknown>,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!session) throw new Error(`${label} called without a verified session`);

  const claims = JSON.stringify(session.claims);

  return begin(async (tx) => {
    // One statement, not four: see `settleSessionSql`.
    await run(tx, settleSessionSql({ claims, searchPath }));

    return fn(tx);
  });
}
