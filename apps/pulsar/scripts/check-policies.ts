/**
 * Drives every policy and grant on `goals` against the real database — and the
 * guard-and-settle body `lib/session.ts`'s `withGoalsDb` runs before every
 * query — instead of reading either from a migration (AGENTS.md,
 * "Verification").
 *
 * Two parts, in the shape of `apps/voyager/scripts/check-sync.ts`:
 *
 * Part 1 drives RLS and grants. Two `randomUUID()` subjects, their
 * `auth.users` rows inserted inside one transaction that always throws at the
 * end to force a ROLLBACK, so nothing survives it and `harness:census` does
 * not move — `@repo/harness-registry` is never needed. Every risky attempt
 * runs inside its own savepoint, so one `42501` never aborts the ones after
 * it. `anon` is driven too and refused everything.
 *
 * Part 2 calls `withSettledTransaction` (`@/lib/settled-transaction`) —
 * the exact function `withGoalsDb` calls, not a copy of it — so a regression
 * to either turns this script red. `withGoalsDb` itself still cannot run from
 * a plain script (`verifiedClaims` needs `next/headers`'s `cookies()`, which
 * throws outside a request — the same wall module 3's own validator hit for
 * orbit), so this part builds its own session object directly instead of
 * asking Supabase for one; only that lookup is out of reach here, not the
 * boundary it guards.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import postgres from "postgres";

import { withSettledTransaction } from "@/lib/settled-transaction";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

let failed = false;

function assert(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (!ok) failed = true;
}

// Nothing here goes through drizzle, so the driver's own PostgresError is the
// thrown value — no cause chain to walk.
function pgCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const { code } = error as { code: unknown };
  return typeof code === "string" ? code : undefined;
}

// Runs `fn` in its own savepoint, so a `42501` it throws never aborts the
// attempts that follow inside the same outer transaction.
async function attempt(
  tx: postgres.TransactionSql,
  fn: (sp: postgres.TransactionSql) => Promise<unknown>,
): Promise<{ code?: string }> {
  let code: string | undefined;
  await tx.savepoint((sp) => fn(sp)).catch((error: unknown) => {
    code = pgCode(error);
  });
  return { code };
}

// Mirrors `withGoalsDb` (`apps/pulsar/lib/session.ts`): one statement, not
// four, and transaction-local (`true`), so re-pointing mid-transaction is
// safe — it never reaches across a reused connection.
async function enterUserContext(tx: postgres.TransactionSql, subject: string): Promise<void> {
  const claims = JSON.stringify({ sub: subject, role: "authenticated", aud: "authenticated" });
  await tx`select
    set_config('request.jwt.claims', ${claims}, true),
    set_config('statement_timeout', '8000', true),
    set_config('search_path', 'goals, public', true),
    set_config('role', 'authenticated', true)`;
}

type Fixtures = {
  goalId: string;
  phaseId: string;
  commitmentId: string;
  factId: string;
  oneOffId: string;
};

// One row of each of the four nouns, plus a phase, for a subject already
// settled into its own context — enough for every cross-identity check below,
// `phases` and `commitments` included (module 27's hole: "driven through the
// door at all").
async function seedFixtures(tx: postgres.TransactionSql, userId: string): Promise<Fixtures> {
  const [goal] = await tx<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon)
    values (${userId}, 'meta de prueba', '2026-12-31') returning id`;
  const [phase] = await tx<{ id: string }[]>`
    insert into goals.phases (user_id, goal_id, aim, starts_on, ends_on)
    values (${userId}, ${goal.id}, 'fase de prueba', '2026-01-01', '2026-12-31') returning id`;
  const [commitment] = await tx<{ id: string }[]>`
    insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction)
    values (${userId}, ${goal.id}, 'compromiso de prueba', 'daily', 'tap') returning id`;
  const [fact] = await tx<{ id: string }[]>`
    insert into goals.facts (user_id, commitment_id, day)
    values (${userId}, ${commitment.id}, '2026-09-22') returning id`;
  const [oneOff] = await tx<{ id: string }[]>`
    insert into goals.one_offs (user_id, name) values (${userId}, 'suelto de prueba') returning id`;

  return {
    goalId: goal.id,
    phaseId: phase.id,
    commitmentId: commitment.id,
    factId: fact.id,
    oneOffId: oneOff.id,
  };
}

async function checkPoliciesAndGrants(sql: postgres.Sql): Promise<void> {
  const subject = randomUUID();
  const intruder = randomUUID();
  const forcedRollback = Symbol("forced rollback");

  // Scoped to these two synthetic ids, never a bare `count(*)`: five lanes
  // share this database and another one's own facts land in this table while
  // this runs (measured live: a `harness-5@example.invalid` row mid-run).
  const [before] = await sql<{ count: string }[]>`
    select count(*)::text as count from goals.facts where user_id in (${subject}, ${intruder})`;

  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${subject}), (${intruder})`;

      await enterUserContext(tx, subject);
      const a = await seedFixtures(tx, subject);

      await enterUserContext(tx, intruder);
      const b = await seedFixtures(tx, intruder);

      await enterUserContext(tx, subject);

      // -- SELECT another person's row of every noun: filtered to zero rows,
      // never an error (RNP-05) --
      const foreignGoal = await tx<{ id: string }[]>`select id from goals.goals where id = ${b.goalId}`;
      assert("P01", foreignGoal.length === 0, `another person's goal, rows visible = ${foreignGoal.length}`);

      const foreignPhase = await tx<{ id: string }[]>`select id from goals.phases where id = ${b.phaseId}`;
      assert("P02", foreignPhase.length === 0, `another person's phase, rows visible = ${foreignPhase.length}`);

      const foreignCommitment = await tx<{ id: string }[]>`
        select id from goals.commitments where id = ${b.commitmentId}`;
      assert(
        "P03",
        foreignCommitment.length === 0,
        `another person's commitment, rows visible = ${foreignCommitment.length}`,
      );

      const foreignFact = await tx<{ id: string }[]>`select id from goals.facts where id = ${b.factId}`;
      assert("P04", foreignFact.length === 0, `another person's fact, rows visible = ${foreignFact.length}`);

      const foreignOneOff = await tx<{ id: string }[]>`select id from goals.one_offs where id = ${b.oneOffId}`;
      assert("P05", foreignOneOff.length === 0, `another person's one-off, rows visible = ${foreignOneOff.length}`);

      // -- cross-identity INSERT refused by `WITH CHECK`, one per owned table:
      // module 21 named this for `facts` alone, module 27's hole names it as
      // structurally unseen everywhere else `WITH CHECK` also guards --
      const insertGoal = await attempt(
        tx,
        (sp) => sp`insert into goals.goals (user_id, name, horizon)
          values (${intruder}, 'ajena', '2026-01-01')`,
      );
      assert("P06", insertGoal.code === "42501", `insert goal as another user, sqlstate = ${insertGoal.code ?? "none"}`);

      const insertPhase = await attempt(
        tx,
        (sp) => sp`insert into goals.phases (user_id, goal_id, aim, starts_on, ends_on)
          values (${intruder}, ${a.goalId}, 'ajena', '2026-01-01', '2026-01-02')`,
      );
      assert(
        "P07",
        insertPhase.code === "42501",
        `insert phase as another user, sqlstate = ${insertPhase.code ?? "none"}`,
      );

      const insertCommitment = await attempt(
        tx,
        (sp) => sp`insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction)
          values (${intruder}, ${a.goalId}, 'ajeno', 'daily', 'tap')`,
      );
      assert(
        "P08",
        insertCommitment.code === "42501",
        `insert commitment as another user, sqlstate = ${insertCommitment.code ?? "none"}`,
      );

      const insertOneOff = await attempt(
        tx,
        (sp) => sp`insert into goals.one_offs (user_id, name) values (${intruder}, 'ajeno')`,
      );
      assert(
        "P09",
        insertOneOff.code === "42501",
        `insert one-off as another user, sqlstate = ${insertOneOff.code ?? "none"}`,
      );

      const insertFact = await attempt(
        tx,
        (sp) => sp`insert into goals.facts (user_id, commitment_id, day)
          values (${intruder}, ${a.commitmentId}, '2026-09-22')`,
      );
      assert("P10", insertFact.code === "42501", `insert fact as another user, sqlstate = ${insertFact.code ?? "none"}`);

      // -- UPDATE: the grant layer narrows every column, not the policy alone --
      const updateFact = await attempt(tx, (sp) => sp`update goals.facts set note = 'x' where id = ${a.factId}`);
      assert("P11", updateFact.code === "42501", `update a fact at all, sqlstate = ${updateFact.code ?? "none"}`);

      const updateCommitmentName = await attempt(
        tx,
        (sp) => sp`update goals.commitments set name = 'renombrado' where id = ${a.commitmentId}`,
      );
      assert(
        "P12",
        updateCommitmentName.code === "42501",
        `update commitment.name, sqlstate = ${updateCommitmentName.code ?? "none"}`,
      );

      const retireCommitment = await attempt(
        tx,
        (sp) => sp`update goals.commitments set retired_at = now() where id = ${a.commitmentId} returning id`,
      );
      assert(
        "P13",
        retireCommitment.code === undefined,
        `update commitment.retired_at, sqlstate = ${retireCommitment.code ?? "none (succeeded)"}`,
      );

      // `phases` holds a `phases_delete_self` policy but no `UPDATE` grant at
      // all — driving it for real, per module 27's hole, is what turns that
      // gap from a claim in the migration into a measurement.
      const updatePhase = await attempt(tx, (sp) => sp`update goals.phases set aim = 'cambiada' where id = ${a.phaseId}`);
      assert("P14", updatePhase.code === "42501", `update a phase at all, sqlstate = ${updatePhase.code ?? "none"}`);

      const updateGoalMeasure = await attempt(
        tx,
        (sp) => sp`update goals.goals set measure_name = 'km', measure_unit = 'km' where id = ${a.goalId}`,
      );
      assert(
        "P15",
        updateGoalMeasure.code === undefined,
        `update goal's measure pair, sqlstate = ${updateGoalMeasure.code ?? "none (succeeded)"}`,
      );

      const updateGoalName = await attempt(tx, (sp) => sp`update goals.goals set name = 'renombrada' where id = ${a.goalId}`);
      assert("P16", updateGoalName.code === "42501", `update goal.name, sqlstate = ${updateGoalName.code ?? "none"}`);

      // -- DELETE: another person's row never disappears, and "retired, never
      // deleted" is a fact of the grant layer even before RLS is asked --
      const deleteForeignFact = await tx`delete from goals.facts where id = ${b.factId}`;
      assert("P17", deleteForeignFact.count === 0, `delete another person's fact, rows deleted = ${deleteForeignFact.count}`);

      const deleteCommitment = await attempt(tx, (sp) => sp`delete from goals.commitments where id = ${a.commitmentId}`);
      assert(
        "P18",
        deleteCommitment.code === "42501",
        `delete own commitment, sqlstate = ${deleteCommitment.code ?? "none"}`,
      );

      // Same shape as `commitments`: a `phases_delete_self` policy exists,
      // no `DELETE` grant backs it, so the door never opens.
      const deletePhase = await attempt(tx, (sp) => sp`delete from goals.phases where id = ${a.phaseId}`);
      assert("P19", deletePhase.code === "42501", `delete own phase, sqlstate = ${deletePhase.code ?? "none"}`);

      // -- evidence_sources: configuration, read-only to everyone --
      const insertSource = await attempt(
        tx,
        (sp) => sp`insert into goals.evidence_sources (key, label_key, unit) values ('forged', 'x', 'x')`,
      );
      assert("P20", insertSource.code === "42501", `insert evidence source, sqlstate = ${insertSource.code ?? "none"}`);

      const readSources = await tx<{ key: string }[]>`select key from goals.evidence_sources`;
      assert(
        "P21",
        readSources.some((row) => row.key === "reading_lookups"),
        `evidence sources visible = ${readSources.map((row) => row.key).join(",") || "none"}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  // `anon` holds no `USAGE` on the `goals` schema at all — denied before RLS
  // is ever asked, for a read and for a write alike.
  await sql
    .begin(async (tx) => {
      await tx`select set_config('role', 'anon', true)`;

      const anonSelectGoals = await attempt(tx, (sp) => sp`select 1 from goals.goals limit 1`);
      assert("P22", anonSelectGoals.code === "42501", `anon select goals, sqlstate = ${anonSelectGoals.code ?? "none"}`);

      const anonSelectFacts = await attempt(tx, (sp) => sp`select 1 from goals.facts limit 1`);
      assert("P23", anonSelectFacts.code === "42501", `anon select facts, sqlstate = ${anonSelectFacts.code ?? "none"}`);

      const anonInsertFact = await attempt(
        tx,
        (sp) => sp`insert into goals.facts (user_id, commitment_id, day)
          values (${randomUUID()}, ${randomUUID()}, '2026-09-22')`,
      );
      assert("P24", anonInsertFact.code === "42501", `anon insert fact, sqlstate = ${anonInsertFact.code ?? "none"}`);

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  const [after] = await sql<{ count: string }[]>`
    select count(*)::text as count from goals.facts where user_id in (${subject}, ${intruder})`;
  assert(
    "P25",
    before.count === "0" && after.count === "0",
    `facts for these two subjects, before = ${before.count}, after = ${after.count}`,
  );
}

// The two adapters `withSettledTransaction` needs to run on a raw `postgres`
// connection instead of drizzle's: `begin` opens this driver's own
// transaction (the same `UnwrapPromiseArray` cast `lib/session.ts` needs for
// `db.transaction`), `run` turns the `SQL` object `settleSessionSql` returns
// into the text-and-params `tx.unsafe` takes.
function beginOn(sql: postgres.Sql) {
  return <T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> => sql.begin(fn) as Promise<T>;
}

async function runOn(tx: postgres.TransactionSql, statement: SQL): Promise<unknown> {
  const query = new PgDialect().sqlToQuery(statement);
  return tx.unsafe(query.sql, query.params as string[]);
}

async function checkSettleMechanism(): Promise<void> {
  const wire: { connId: number; sql: string }[] = [];
  const sql = postgres(DATABASE_URL!, {
    prepare: false,
    max: 1,
    debug: (connId, query) => wire.push({ connId, sql: query }),
  });

  const session = { claims: { sub: randomUUID(), role: "authenticated", aud: "authenticated" } };

  // With a session: the real `withSettledTransaction` actually seats the role
  // and drops BYPASSRLS, driven end to end rather than asserted from the file
  // — the very function `withGoalsDb` calls, not a copy of it.
  const [seated] = await withSettledTransaction<postgres.TransactionSql, { role: string; bypasses: boolean }[]>(
    session,
    "check-policies",
    "goals, public",
    beginOn(sql),
    runOn,
    (tx) =>
      tx<{ role: string; bypasses: boolean }[]>`
        select current_user as role,
               (select rolbypassrls from pg_roles where rolname = current_user) as bypasses`,
  );
  assert(
    "P26",
    seated.role === "authenticated" && seated.bypasses === false,
    `role = ${seated.role}, bypassrls = ${seated.bypasses}`,
  );

  // `is_local = true` (the third argument to every `set_config` in
  // `settleSessionSql`) is what keeps the settle from surviving its own
  // transaction. `max: 1` reuses one physical connection for this whole
  // client, so a bare, unsettled statement right after `seated` above proves
  // nothing leaked onto it — flipping that argument to `false` is exactly
  // what turns this assertion red.
  const [bare] = await sql<{ role: string }[]>`select current_user as role`;
  assert("P27", bare.role !== "authenticated", `role on the same connection after commit = ${bare.role}`);

  // Without a session: the guard must throw before `sql.begin` ever runs, so
  // zero statements reach the wire — read from this pool's own instrumented
  // log, not inferred from a flat log's first "begin" (module 27's hole:
  // that method cannot tell one transaction's statements from another's).
  const sentBefore = wire.length;
  let threw = false;
  await withSettledTransaction(null, "check-policies", "goals, public", beginOn(sql), runOn, async () => undefined).catch(
    () => {
      threw = true;
    },
  );
  const sentWithNoSession = wire.length - sentBefore;
  assert(
    "P28",
    threw && sentWithNoSession === 0,
    `threw = ${threw}, statements sent while unauthenticated = ${sentWithNoSession}`,
  );

  await sql.end();
}

// Module 27's hole: a statement count must read its own connection, not
// assume the first "begin" in a merged log belongs to the transaction under
// test. Two real, concurrently open connections (`max: 1` each, run
// interleaved) prove the technique: every entry in one client's own debug log
// carries that client's own connection id and no other's, so counting "this
// transaction's statements" by filtering on id — never by scanning for the
// first literal "begin" — survives concurrency a flat log cannot represent.
async function checkStatementAttributionByConnection(): Promise<void> {
  const wireA: { connId: number; sql: string }[] = [];
  const wireB: { connId: number; sql: string }[] = [];
  const sqlA = postgres(DATABASE_URL!, { prepare: false, max: 1, debug: (id, query) => wireA.push({ connId: id, sql: query }) });
  const sqlB = postgres(DATABASE_URL!, { prepare: false, max: 1, debug: (id, query) => wireB.push({ connId: id, sql: query }) });

  const [[pidA], [pidB]] = await Promise.all([
    sqlA.begin(async (tx) => {
      await tx`select pg_sleep(0.05)`;
      return tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    }),
    sqlB.begin(async (tx) => {
      await tx`select pg_sleep(0.05)`;
      return tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    }),
  ]);

  const idsA = new Set(wireA.map((entry) => entry.connId));
  const idsB = new Set(wireB.map((entry) => entry.connId));
  const disjoint = ![...idsA].some((id) => idsB.has(id));

  assert(
    "P29",
    pidA.pid !== pidB.pid && idsA.size === 1 && idsB.size === 1 && disjoint,
    `two interleaved transactions, backend pids ${pidA.pid} / ${pidB.pid}, ` +
      `wire connection ids {${[...idsA]}} / {${[...idsB]}}, disjoint = ${disjoint}`,
  );

  await sqlA.end();
  await sqlB.end();
}

// Module 27's hole: the real `@supabase/supabase-js` client, not a stub whose
// notion of "verified" is an environment variable.
async function checkRealClientRejectsBadTokens(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set");

  const client = createClient(url, key);

  // A real network round trip against Supabase's own JWKS/verification
  // endpoint — the same call `verifiedClaims` makes — rejects a token that
  // never had a valid signature to begin with.
  const garbage = await client.auth.getClaims("this.is-not.a-jwt");
  assert("P30", garbage.error !== null, `getClaims on a malformed token, error = ${garbage.error?.message ?? "none"}`);

  // Anonymous sign-in is off at the project level. This app's own `lib/env.ts`
  // holds no service-role key on purpose ("a service_role key would bypass
  // every RLS policy"), so a script here has no way to delete a row it might
  // mint by actually signing in anonymously — RNP-09 forbids minting one
  // this app cannot register and clean up. The boundary is proven at the
  // settings door, live against the real project, instead.
  const settings = (await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } }).then((response) =>
    response.json(),
  )) as { external?: { anonymous_users?: boolean } };
  assert(
    "P31",
    settings.external?.anonymous_users === false,
    `external.anonymous_users = ${settings.external?.anonymous_users}`,
  );
}

async function main(): Promise<void> {
  const sql = postgres(DATABASE_URL!, {
    prepare: false,
    max: 1,
    connection: { search_path: "goals, public" },
  });

  await checkPoliciesAndGrants(sql);
  await sql.end();

  await checkSettleMechanism();
  await checkStatementAttributionByConnection();
  await checkRealClientRejectsBadTokens();

  if (failed) process.exit(1);
}

main();
