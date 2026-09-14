/**
 * Drives `reading.word_texts` and `reading.model_spend` instead of asserting
 * them from the migration (AGENTS.md, "Verification").
 *
 * Eight savepoints inside one `sql.begin`, forced to ROLLBACK at the end, so
 * the permission checks touch nothing: no policy exists on either table, so
 * no `auth.users` row is needed for the claims to mean anything (unlike
 * `check-sync.ts`'s subjects) — the block is at the GRANT/REVOKE layer alone.
 *
 * The cap check is the one part that is not a rollback: it is a real HTTP
 * call against a running server (`VOYAGER_BASE_URL`, default the lane's own
 * :3101), so it seeds and restores `model_spend`'s own row for today and a
 * `word_texts` row for a headword nothing else in this repo names.
 */
import { settleSessionSql } from "@repo/supabase-auth/settle";
import { PgDialect } from "drizzle-orm/pg-core";
import postgres from "postgres";

const BASE_URL = process.env.VOYAGER_BASE_URL ?? "http://localhost:3101";
// Real dictionary headword, absent from every spec and fixture this repo
// carries — free to seed and delete without touching anyone's cache.
const COLD_HEADWORD = "narwhal";
// Above any cap this repo would plausibly configure, so the cap assertion
// holds whether or not `WORD_TEXT_DAILY_CALL_CAP` is set on the server under
// test — the route's "no cap configured" fallback answers 204 too.
const OVER_CAP_CALLS = 1_000_000;

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

// Mirrors `check-sync.ts`: no cause chain to walk outside drizzle, so the
// driver's own PostgresError is the thrown value.
function pgCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const { code } = error as { code: unknown };
  return typeof code === "string" ? code : undefined;
}

// The real `settleSessionSql` from `@repo/supabase-auth/settle` — the same
// one `withReaderDb` (`lib/session.ts`) uses — never a hand-rolled
// `set_config`. A `42P01` below would mean this landed wrong, not that the
// permission bit (`docs/TRAPS.md:895-911`).
async function enterAuthenticatedContext(tx: postgres.TransactionSql, subject: string): Promise<void> {
  const claims = JSON.stringify({ sub: subject, role: "authenticated", aud: "authenticated" });
  const settle = new PgDialect().sqlToQuery(settleSessionSql({ claims, searchPath: "reading, public" }));
  await tx.unsafe(settle.sql, settle.params as string[]);
}

// A savepoint per attempt: one 42501 must not abort the eleven statements
// after it, the way an unguarded statement would abort the whole transaction.
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

type WordTextsRow = { headword: string; definition: string | null; example_en: string; example_es: string; model: string };
type ModelSpendRow = { day: string; calls: number };

async function main() {
  const subject = crypto.randomUUID();
  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      await enterAuthenticatedContext(tx, subject);

      await denied(tx, "T5", (sp) => sp`select 1 from reading.word_texts limit 1`);
      await denied(
        tx,
        "T6",
        (sp) =>
          sp`insert into reading.word_texts (headword, example_en, example_es, model) values ('permcheck', 'x', 'y', 'z')`,
      );
      await denied(tx, "T7", (sp) => sp`update reading.word_texts set model = 'z' where headword = 'permcheck'`);
      await denied(tx, "T8", (sp) => sp`delete from reading.word_texts where headword = 'permcheck'`);

      await denied(tx, "T9", (sp) => sp`select 1 from reading.model_spend limit 1`);
      // Neither the insert (T10) nor the delete (T12) names the `photos`
      // column: once a migration drops it, keeping it here would turn a
      // dropped-column error (42703) into this check's FAIL — a false
      // signal against the REVOKE, not proof it lapsed.
      await denied(
        tx,
        "T10",
        (sp) => sp`insert into reading.model_spend (day, calls) values (current_date + 999, 0)`,
      );
      await denied(tx, "T11", (sp) => sp`update reading.model_spend set calls = calls where day = current_date`);
      await denied(tx, "T12", (sp) => sp`delete from reading.model_spend where day = current_date + 999`);

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  // T13 narrows from three RLS tables to two: `word_photos` left this check
  // along with T1–T4, T16 and T17 — the same assertion over fewer objects,
  // not a label reused for something else.
  const rel = await sql<{ relname: string; rowsecurity: boolean }[]>`
    select relname, relrowsecurity as rowsecurity
    from pg_class
    where oid in ('reading.word_texts'::regclass, 'reading.model_spend'::regclass)`;
  assert(
    "T13",
    rel.length === 2 && rel.every((r) => r.rowsecurity === true),
    `rowsecurity = ${rel.map((r) => `${r.relname}:${r.rowsecurity}`).join(", ")}`,
  );

  const policies = await sql<{ tablename: string }[]>`
    select tablename from pg_policies
    where schemaname = 'reading' and tablename in ('word_texts', 'model_spend')`;
  assert("T14", policies.length === 0, `policy count = ${policies.length}`);

  // The cap, without spending a cent: seed `model_spend` for today over any
  // plausible cap, seed a cold `word_texts` slot, then drive the real route.
  // A correct `POST /api/word/text` claims the cap before it ever reaches
  // OpenAI, so a real model call here is a defect in module 5, not this
  // script (dispatch note).
  const [priorTextRow] = await sql<WordTextsRow[]>`
    select * from reading.word_texts where headword = ${COLD_HEADWORD}`;
  if (priorTextRow) {
    await sql`delete from reading.word_texts where headword = ${COLD_HEADWORD}`;
  }

  const [priorSpendRow] = await sql<ModelSpendRow[]>`
    select day::text as day, calls from reading.model_spend where day = current_date`;
  await sql`
    insert into reading.model_spend as ms (day, calls)
    values (current_date, ${OVER_CAP_CALLS})
    on conflict (day) do update set calls = ${OVER_CAP_CALLS}`;

  let status: number | undefined;
  let fetchError: string | undefined;
  try {
    const response = await fetch(`${BASE_URL}/api/word/text`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ headword: COLD_HEADWORD, needDefinition: true }),
    });
    status = response.status;
  } catch (error) {
    fetchError = error instanceof Error ? error.message : String(error);
  }

  const [afterTextRow] = await sql<WordTextsRow[]>`
    select * from reading.word_texts where headword = ${COLD_HEADWORD}`;
  const [afterSpendRow] = await sql<ModelSpendRow[]>`
    select calls from reading.model_spend where day = current_date`;
  const callsGrowth = (afterSpendRow?.calls ?? 0) - OVER_CAP_CALLS;

  assert(
    "T15",
    status === 204 && !afterTextRow && callsGrowth <= 1,
    `status = ${status ?? `fetch failed: ${fetchError}`}, new word_texts row = ${Boolean(afterTextRow)}, calls grew by ${callsGrowth}`,
  );

  // Clean up what T15 seeded, in this same run — never a truncate, never a
  // row this script did not write itself.
  if (afterTextRow) await sql`delete from reading.word_texts where headword = ${COLD_HEADWORD}`;
  if (priorTextRow) {
    await sql`
      insert into reading.word_texts (headword, definition, example_en, example_es, model)
      values (${priorTextRow.headword}, ${priorTextRow.definition}, ${priorTextRow.example_en}, ${priorTextRow.example_es}, ${priorTextRow.model})`;
  }
  if (priorSpendRow) {
    await sql`update reading.model_spend set calls = ${priorSpendRow.calls} where day = current_date`;
  } else {
    await sql`delete from reading.model_spend where day = current_date`;
  }

  await sql.end();
  if (failed) process.exit(1);
}

main();
