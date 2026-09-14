/**
 * Drives the grant layer of `reading.word_answers`, `reading.phrase_notes`
 * and `reading.client_spend` against the real database — DELETE never even
 * attempted, because SELECT and INSERT alone already prove the REVOKE
 * (AGENTS.md, "Verification"). No policy exists on these three, so no
 * `auth.users` row is needed for a role switch to mean anything, unlike
 * `check-sync.ts`'s subjects — the block is at the GRANT/REVOKE layer alone.
 *
 * Two `sql.begin` blocks, one per role, each forced to ROLLBACK at the end
 * so the transaction touches nothing real even where a grant would have let
 * a statement through.
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: 1,
  connection: { search_path: "reading, public" },
});

let failed = false;

function assert(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (!ok) failed = true;
}

// Mirrors `check-sync.ts` and `check-decoration.ts`: no cause chain to walk
// outside drizzle, so the driver's own PostgresError is the thrown value.
function pgCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const { code } = error as { code: unknown };
  return typeof code === "string" ? code : undefined;
}

// A savepoint per attempt: one 42501 must not abort the statements after it,
// the way an unguarded statement would abort the whole transaction.
async function denied(
  tx: postgres.TransactionSql,
  label: string,
  fn: (sp: postgres.TransactionSql) => Promise<unknown>,
): Promise<void> {
  let code: string | undefined;
  await tx.savepoint((sp) => fn(sp)).catch((error: unknown) => {
    code = pgCode(error);
  });
  assert(label, code === "42501", `sqlstate = ${code ?? "none — the statement went through"}`);
}

// `set_config` alone, never `settleSessionSql`: that helper hardcodes
// `role = 'authenticated'`, and this script needs `anon` too. No JWT claims
// either — with zero policies on these three tables, nothing reads them.
async function enterRole(tx: postgres.TransactionSql, role: "anon" | "authenticated"): Promise<void> {
  await tx`select set_config('role', ${role}, true)`;
}

async function checkRole(role: "anon" | "authenticated"): Promise<void> {
  const forcedRollback = Symbol("forced rollback");
  await sql
    .begin(async (tx) => {
      await enterRole(tx, role);

      await denied(tx, `${role} select word_answers`, (sp) => sp`select 1 from reading.word_answers limit 1`);
      await denied(
        tx,
        `${role} insert word_answers`,
        (sp) => sp`
          insert into reading.word_answers (word, translations, example_en, example_es, model)
          values ('permcheck', array['x'], 'x', 'x', 'z')`,
      );

      await denied(tx, `${role} select phrase_notes`, (sp) => sp`select 1 from reading.phrase_notes limit 1`);
      await denied(
        tx,
        `${role} insert phrase_notes`,
        (sp) => sp`
          insert into reading.phrase_notes (phrase_hash, notes, model)
          values ('permcheck', '[]'::jsonb, 'z')`,
      );

      await denied(tx, `${role} select client_spend`, (sp) => sp`select 1 from reading.client_spend limit 1`);
      await denied(
        tx,
        `${role} insert client_spend`,
        (sp) => sp`
          insert into reading.client_spend (day, client, calls)
          values (current_date, 'permcheck', 0)`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });
}

async function main() {
  await checkRole("anon");
  await checkRole("authenticated");

  await sql.end();
  if (failed) process.exit(1);
}

main();
