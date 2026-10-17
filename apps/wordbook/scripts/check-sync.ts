/**
 * Drives the policies on `reading.lookups` and `reading.devices` against the
 * real database — DELETE included — instead of asserting them from the
 * migration (AGENTS.md, "Code"), and the real statements of
 * `lib/sync/upload.ts` and `lib/sync/devices.ts` through them.
 *
 * S1-S21 run in transactions that always throw at the end to force a
 * ROLLBACK: their subjects' `auth.users` rows are inserted inside them and
 * nothing survives. S22 needs real commits, so its one reader is registered
 * through `@repo/harness-registry` in the same transaction that creates it,
 * and deleted at the end; a run killed in between leaves a row that
 * `harness:census` counts and `harness:reap` prunes.
 */
import { randomUUID } from "node:crypto";

import Module from "node:module";

import { assertSuiteDatabase, closeRun, openRun } from "@repo/harness-registry";
import { settleSessionSql } from "@repo/supabase-auth/settle";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Transaction } from "../lib/session";
import { deviceLabel } from "../lib/sync/device-label";
import { decodeCursor, syncRequestSchema, syncRowSchema, type SyncRow } from "../lib/sync/protocol";

assertSuiteDatabase();

// `server-only` throws outside Next; `lib/sync/upload.ts` and `devices.ts`
// import it, and are loaded with `await import` in `main` once this is in place.
const untypedModule = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = untypedModule._load;
// The route is driven for S30/S31 with the session stood in for: the reader is
// the one the block created, and `run` opens the same settled transaction.
const sessionStub: { readerId: string; run: (work: (tx: Transaction) => Promise<unknown>) => Promise<unknown> } = {
  readerId: "",
  run: () => Promise.reject(new Error("session stub not set")),
};
untypedModule._load = (request, parent, isMain) => {
  if (request === "server-only") return {};
  if (/(^|\/)lib\/session(\.ts)?$/.test(request)) {
    return {
      getReader: async () => ({ id: sessionStub.readerId, email: "" }),
      withReaderDb: (work: (tx: Transaction) => Promise<unknown>) => sessionStub.run(work),
    };
  }
  return originalLoad(request, parent, isMain);
};

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

// Nothing here goes through drizzle, so the driver's own PostgresError is the
// thrown value — no cause chain to walk, unlike `apps/homefund/lib/db-error.ts`.
function pgCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const { code } = error as { code: unknown };
  return typeof code === "string" ? code : undefined;
}

// Mirrors `withReaderDb` (`apps/wordbook/lib/session.ts`): one statement, not
// four, and transaction-local (`true`), so re-pointing mid-transaction is
// safe — it never reaches across a reused connection (`docs/TRAPS.md:389`).
async function enterUserContext(tx: postgres.TransactionSql, subject: string): Promise<void> {
  const claims = JSON.stringify({ sub: subject, role: "authenticated", aud: "authenticated" });
  await tx`select
    set_config('request.jwt.claims', ${claims}, true),
    set_config('statement_timeout', '8000', true),
    set_config('search_path', 'reading, public', true),
    set_config('role', 'authenticated', true)`;
}

async function insertLookup(
  tx: postgres.TransactionSql,
  userId: string,
  deviceId: string,
  localId: number,
  text: string,
  onConflictDoNothing = false,
) {
  return tx`insert into reading.lookups
    (user_id, device_id, local_id, at, text, normalised, kind, outcome, senses, dictionary_ready, record_schema)
    values (${userId}, ${deviceId}, ${localId}, now(), ${text}, ${text}, 'word', 'exact', 0, true, 1)
    ${onConflictDoNothing ? tx`on conflict (user_id, device_id, local_id) do nothing` : tx``}`;
}

async function countLookups(tx: postgres.TransactionSql, userId: string, deviceId: string): Promise<string> {
  const [row] = await tx<{ count: string }[]>`
    select count(*)::text as count from reading.lookups where user_id = ${userId} and device_id = ${deviceId}`;
  return row.count;
}

async function countDevice(tx: postgres.TransactionSql, userId: string, deviceId: string): Promise<string> {
  const [row] = await tx<{ count: string }[]>`
    select count(*)::text as count from reading.devices where user_id = ${userId} and device_id = ${deviceId}`;
  return row.count;
}

// The real `writeUpload`, `downloadRows`, `listDevices` and `retireDevice`
// take a drizzle transaction; this wraps the probe's own postgres.js one, so
// they run inside the forced-rollback block under the probe's settled role.
// Only `execute` is ever called, which reaches `unsafe` and nothing else.
function readerTx(tx: postgres.TransactionSql): Transaction {
  const client = { options: { parsers: {}, serializers: {} }, unsafe: tx.unsafe.bind(tx) };
  return drizzle({ client: client as unknown as postgres.Sql, casing: "snake_case" }) as unknown as Transaction;
}

function rowsOf(deviceId: string, localIds: number[]): SyncRow[] {
  return localIds.map((localId) => ({
    deviceId,
    localId,
    at: Date.now(),
    text: "x",
    normalised: "x",
    kind: "word",
    outcome: "exact",
    headword: null,
    rule: null,
    senses: 0,
    translation: null,
    dictionaryReady: true,
    origin: null,
    recordSchema: 1,
  }));
}

async function deviceState(
  tx: postgres.TransactionSql,
  userId: string,
  deviceId: string,
): Promise<{ label: string; seenYear: number; retired: boolean } | undefined> {
  const [row] = await tx<{ label: string; seen_year: number; retired: boolean }[]>`
    select label, extract(year from last_seen_at)::int as seen_year, retired_at is not null as retired
    from reading.devices where user_id = ${userId} and device_id = ${deviceId}`;
  return row && { label: row.label, seenYear: row.seen_year, retired: row.retired };
}

type RoundAnswer = {
  status: number;
  json: { accepted: number; tombstones?: { deviceId: string; localId: number }[]; tombstoneCursor: string | null };
};

// `SYNC_ONLY=S43` or `S44` runs that case alone, so a mutant is proved against the case that kills it.
async function checkRolledBackRounds(only?: string): Promise<void> {
  const keyOf = (tombstone: { deviceId: string; localId: number }) => `${tombstone.deviceId}:${tombstone.localId}`;
  // S43-S44: the route driven inside one transaction that always rolls back. The reader's `auth.users` row is
  // inserted in it, and every round of the block runs on that same settled transaction.
  const rolledBack = async (
    label: string,
    work: (ctx: {
      reader: string;
      tx: postgres.TransactionSql;
      post: (body: Record<string, unknown>) => Promise<RoundAnswer>;
    }) => Promise<void>,
  ): Promise<void> => {
    const forcedRollback = Symbol("forced rollback");
    const { POST } = await import("../app/api/log/sync/route");
    const reader = randomUUID();
    await sql
      .begin(async (tx) => {
        await tx`insert into auth.users (id) values (${reader})`;
        const post = async (body: Record<string, unknown>): Promise<RoundAnswer> => {
          sessionStub.readerId = reader;
          sessionStub.run = async (fn) => {
            await enterUserContext(tx, reader);
            return fn(readerTx(tx));
          };
          const response = await POST(
            new Request("http://localhost/api/log/sync", { method: "POST", body: JSON.stringify({ readerId: reader, ...body }) }),
          );
          return { status: response.status, json: (await response.json()) as RoundAnswer["json"] };
        };
        await work({ reader, tx, post });
        throw forcedRollback;
      })
      .catch((error: unknown) => {
        if (error === forcedRollback) return;
        assert(`${label} aborted`, false, `${pgCode(error) ?? "no sqlstate"} ${error instanceof Error ? error.message : String(error)}`);
      });
  };

  // S43: 501 marks one second apart, the newest on the smallest identity, so neither the identity nor a
  // descending clock can stand in for the tuple order; two pages hand down all of them once, oldest first.
  if (!only || only === "S43") await rolledBack("S43", async ({ reader, tx, post }) => {
    const [low, high] = [randomUUID(), randomUUID()].sort();
    const viewer = randomUUID();
    await tx`insert into reading.lookup_tombstones (user_id, device_id, local_id, received_at, deleted_at)
      select ${reader}, case when i % 2 = 0 then ${low}::uuid else ${high}::uuid end, 502 - i, now(),
             timestamptz '2026-01-01 00:00:00.123456+00' + i * interval '1 second'
      from generate_series(1, 501) as i`;
    const owed = Array.from({ length: 501 }, (_, k) => `${(k + 1) % 2 === 0 ? low : high}:${501 - k}`);
    const first = await post({ deviceId: viewer, rows: [], since: null, tombstones: [], tombstonesSince: null });
    const second = await post({ deviceId: viewer, rows: [], since: null, tombstones: [], tombstonesSince: first.json.tombstoneCursor });
    const keys = [...(first.json.tombstones ?? []), ...(second.json.tombstones ?? [])].map(keyOf);
    const missing = owed.filter((key) => !keys.includes(key)).length;
    const inOrder = keys.join() === owed.join();
    assert(
      "S43",
      first.status === 200 && second.status === 200 && keys.length === 501 && new Set(keys).size === 501 && missing === 0 && inOrder,
      `status = ${first.status}/${second.status}, pages = ${(first.json.tombstones ?? []).length} + ${(second.json.tombstones ?? []).length}, distinct = ${new Set(keys).size}, missing = ${missing}, oldest first = ${inOrder}`,
    );
  });

  // S44: on an empty copy, a round that sends (A,9) and names it for deletion stores nothing.
  // S44b: the deleted search does not come back when a later round sends it alone (RL-70: no device sends it up again).
  if (!only || only === "S44") await rolledBack("S44", async ({ reader, tx, post }) => {
    const a = randomUUID();
    const stored = async () =>
      (await tx<{ n: string }[]>`select count(*)::text as n from reading.lookups where user_id = ${reader} and device_id = ${a} and local_id = 9`)[0].n;
    const both = await post({ deviceId: a, rows: rowsOf(a, [9]), since: null, tombstones: [{ deviceId: a, localId: 9 }], tombstonesSince: null });
    const afterBoth = await stored();
    assert("S44", both.status === 200 && both.json.accepted === 0 && afterBoth === "0", `status = ${both.status}, accepted = ${both.json.accepted}, lookups (A,9) = ${afterBoth}`);
    const alone = await post({ deviceId: a, rows: rowsOf(a, [9]), since: null, tombstones: [], tombstonesSince: null });
    const afterAlone = await stored();
    assert("S44b", alone.status === 200 && alone.json.accepted === 0 && afterAlone === "0", `status = ${alone.status}, accepted = ${alone.json.accepted}, lookups (A,9) = ${afterAlone}`);
  });
}

async function main() {
  if (process.env.SYNC_ONLY) {
    await checkRolledBackRounds(process.env.SYNC_ONLY);
    await sql.end();
    process.exit(failed ? 1 : 0);
  }

  const { downloadRows, writeUpload } = await import("../lib/sync/upload");
  const { listDevices, retireDevice } = await import("../lib/sync/devices");

  const subject = randomUUID();
  const intruder = randomUUID();
  const deviceSubject = randomUUID();
  // The intruder holds two devices, so S12 can prove that retiring one never
  // touches the other's rows — a device-scoped delete, not a user-scoped one.
  const deviceIntruderMain = randomUUID();
  const deviceIntruderOther = randomUUID();
  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      const [rel] = await tx<{ rowsecurity: boolean; forced: boolean }[]>`
        select relrowsecurity as rowsecurity, relforcerowsecurity as forced
        from pg_class where oid = 'reading.lookups'::regclass`;
      assert(
        "S1",
        rel.rowsecurity === true && rel.forced === true,
        `relrowsecurity = ${rel.rowsecurity}, relforcerowsecurity = ${rel.forced}`,
      );

      const strayGrants = await tx<{ grantee: string; table_name: string; privilege_type: string }[]>`
        select grantee, table_name, privilege_type
        from information_schema.role_table_grants
        where table_schema = 'reading' and table_name in ('lookups', 'devices')
          and grantee in ('anon', 'service_role')`;
      assert("S2", strayGrants.length === 0, `anon/service_role grants = ${strayGrants.length}`);

      const insertCols = await tx<{ column_name: string }[]>`
        select column_name from information_schema.column_privileges
        where table_schema = 'reading' and table_name = 'lookups'
          and grantee = 'authenticated' and privilege_type = 'INSERT'`;
      const cols = insertCols.map((r) => r.column_name);
      assert(
        "S3",
        cols.length === 18 && cols.includes("translation") && cols.includes("definition") && !cols.includes("received_at"),
        `${cols.length} insertable columns, translation = ${cols.includes("translation")}, received_at = ${cols.includes("received_at")}`,
      );

      await tx`insert into auth.users (id) values (${subject}), (${intruder})`;

      await enterUserContext(tx, subject);
      await insertLookup(tx, subject, deviceSubject, 1, "hello");
      const [ownRow] = await tx<{ user_id: string }[]>`
        select user_id from reading.lookups where user_id = ${subject} and device_id = ${deviceSubject} and local_id = 1`;
      assert("S4", ownRow?.user_id === subject, `row found = ${Boolean(ownRow)}`);

      await enterUserContext(tx, intruder);
      const [{ count: intruderSees }] = await tx<{ count: string }[]>`
        select count(*)::text as count from reading.lookups where user_id = ${subject}`;
      assert("S5", intruderSees === "0", `rows visible to the intruder = ${intruderSees}`);

      await enterUserContext(tx, subject);
      let foreignInsertCode: string | undefined;
      await tx
        .savepoint((sp) => insertLookup(sp, intruder, deviceSubject, 99, "forged"))
        .catch((error: unknown) => {
          foreignInsertCode = pgCode(error);
        });
      assert("S6", foreignInsertCode === "42501", `sqlstate = ${foreignInsertCode ?? "none"}`);

      const beforeReinsert = await countLookups(tx, subject, deviceSubject);
      await insertLookup(tx, subject, deviceSubject, 1, "hello", true);
      const afterReinsert = await countLookups(tx, subject, deviceSubject);
      assert("S7", beforeReinsert === afterReinsert, `before = ${beforeReinsert}, after = ${afterReinsert}`);

      let updateRows: number | undefined;
      let updateCode: string | undefined;
      await tx
        .savepoint(async (sp) => {
          const result = await sp`
            update reading.lookups set text = 'changed'
            where user_id = ${subject} and device_id = ${deviceSubject} and local_id = 1`;
          updateRows = result.count;
        })
        .catch((error: unknown) => {
          updateCode = pgCode(error);
        });
      assert(
        "S8",
        updateRows === 0 || updateCode !== undefined,
        `rows affected = ${updateRows ?? "n/a"}, sqlstate = ${updateCode ?? "none"}`,
      );

      await insertLookup(tx, subject, deviceSubject, 2, "second");
      await insertLookup(tx, subject, deviceSubject, 3, "third");
      // `::text` on both sides of every comparison below: postgres.js resolves
      // a bare string parameter's wire type from how the query uses it, and a
      // parameter Postgres calls `timestamptz` gets re-serialized through
      // `new Date(x).toISOString()` (`node_modules/postgres/src/types.js:31`),
      // which floors microseconds. Comparing text to text never asks for that
      // cast, so the cursor keeps the precision the column actually holds.
      const [cursorRow, laterRow] = await tx<{ local_id: number; received_at: string }[]>`
        select local_id, received_at::text as received_at from reading.lookups
        where user_id = ${subject} and device_id = ${deviceSubject} and local_id in (2, 3)
        order by local_id`;
      const nonDecreasing = cursorRow.received_at <= laterRow.received_at;
      const afterCursor = await tx<{ local_id: number }[]>`
        select local_id from reading.lookups
        where user_id = ${subject} and received_at::text > ${cursorRow.received_at}
        order by received_at asc limit 500`;
      const cursorExcludesDownloaded = !afterCursor.some((row) => row.local_id === cursorRow.local_id);
      assert(
        "S9",
        nonDecreasing && cursorExcludesDownloaded,
        `non-decreasing = ${nonDecreasing}, cursor excludes local_id ${cursorRow.local_id} = ${cursorExcludesDownloaded}`,
      );

      await tx`insert into reading.devices (user_id, device_id, label) values (${subject}, ${deviceSubject}, 'reader A device')`;

      const lookupsBeforeOwn = await countLookups(tx, subject, deviceSubject);
      const ownRetired = await retireDevice(readerTx(tx), subject, deviceSubject);
      const lookupsAfterOwn = await countLookups(tx, subject, deviceSubject);
      const ownAfter = await deviceState(tx, subject, deviceSubject);
      assert(
        "S10",
        lookupsBeforeOwn === "3" && ownRetired.lookups === 3 && lookupsAfterOwn === "0" && ownAfter?.retired === true,
        `lookups ${lookupsBeforeOwn} -> ${lookupsAfterOwn} (reported ${ownRetired.lookups}), device row kept retired = ${ownAfter?.retired}`,
      );

      await enterUserContext(tx, intruder);
      await tx`insert into reading.devices (user_id, device_id, label) values (${intruder}, ${deviceIntruderMain}, 'reader B device main')`;
      await tx`insert into reading.devices (user_id, device_id, label) values (${intruder}, ${deviceIntruderOther}, 'reader B device other')`;
      await insertLookup(tx, intruder, deviceIntruderMain, 1, "b1");
      await insertLookup(tx, intruder, deviceIntruderMain, 2, "b2");
      await insertLookup(tx, intruder, deviceIntruderOther, 1, "c1");

      // The attack: the reader A session runs the retire statement narrowed
      // only by `device_id`, no `user_id` — proving the policy stops it, not
      // the `where` clause the app happens to also send (module 20's note).
      await enterUserContext(tx, subject);
      const attack = await tx<{ lookups: string }[]>`
        with gone as (
          delete from reading.lookups where device_id = ${deviceIntruderMain} returning 1
        )
        update reading.devices set retired_at = now() where device_id = ${deviceIntruderMain}
        returning (select count(*) from gone) as lookups`;

      await enterUserContext(tx, intruder);
      const mainLookupsAfterAttack = await countLookups(tx, intruder, deviceIntruderMain);
      const mainDeviceAfterAttack = await deviceState(tx, intruder, deviceIntruderMain);
      assert(
        "S11",
        attack.length === 0 && mainLookupsAfterAttack === "2" && mainDeviceAfterAttack?.retired === false,
        `outer update rows = ${attack.length}, B's rows survive = ${mainLookupsAfterAttack} lookups, device retired = ${mainDeviceAfterAttack?.retired}`,
      );

      const otherLookupsBefore = await countLookups(tx, intruder, deviceIntruderOther);
      const otherDeviceBefore = await countDevice(tx, intruder, deviceIntruderOther);
      // The legitimate retirement: the real `retireDevice`, run by its owner.
      const retiredMain = await retireDevice(readerTx(tx), intruder, deviceIntruderMain);
      const otherLookupsAfter = await countLookups(tx, intruder, deviceIntruderOther);
      const otherDeviceAfter = await countDevice(tx, intruder, deviceIntruderOther);
      assert(
        "S12",
        retiredMain.lookups === 2 && otherLookupsBefore === otherLookupsAfter && otherDeviceBefore === otherDeviceAfter,
        `main device retired ${retiredMain.lookups} lookups; other device untouched: lookups ${otherLookupsBefore} -> ${otherLookupsAfter}, device ${otherDeviceBefore} -> ${otherDeviceAfter}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  // Everything above proves the policies decide, but only because the session
  // runs as `authenticated`. The login role is `postgres`, which holds
  // BYPASSRLS: drop the role line from `settleSessionSql` and every policy
  // stops applying, in both apps, with all twelve assertions above still
  // green — they settle the role themselves. So this one drives the shared
  // statement instead of mirroring it, in its own transaction, because
  // `set_config(…, true)` is transaction-local and the role the block above
  // set would answer for it.
  await sql
    .begin(async (tx) => {
      const [before] = await tx<{ role: string }[]>`select current_user as role`;
      const claims = JSON.stringify({ sub: randomUUID(), role: "authenticated", aud: "authenticated" });
      const settle = new PgDialect().sqlToQuery(settleSessionSql({ claims, searchPath: "reading, public" }));
      await tx.unsafe(settle.sql, settle.params as string[]);
      const [after] = await tx<{ role: string; bypasses: boolean }[]>`
        select current_user as role,
               (select rolbypassrls from pg_roles where rolname = current_user) as bypasses`;
      assert(
        "S13",
        before.role !== "authenticated" && after.role === "authenticated" && after.bypasses === false,
        `role ${before.role} -> ${after.role}, bypassrls = ${after.bypasses}`,
      );
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  // S14-S21 run in a transaction of their own, appended after S13 so the
  // numbering above does not move.
  const owner = randomUUID();
  const other = randomUUID();
  const deviceA = randomUUID();
  const deviceB = randomUUID();
  const deviceC = randomUUID();
  const deviceD = randomUUID();
  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${owner}), (${other})`;
      await enterUserContext(tx, owner);
      await tx`insert into reading.devices (user_id, device_id, label) values (${owner}, ${deviceA}, 'chrome:android')`;

      await enterUserContext(tx, other);
      const [{ count: otherSeesDevices }] = await tx<{ count: string }[]>`
        select count(*)::text as count from reading.devices where user_id = ${owner}`;
      assert("S14", otherSeesDevices === "0", `devices of the owner visible to the other reader = ${otherSeesDevices}`);

      let forgedDeviceCode: string | undefined;
      await tx
        .savepoint((sp) => sp`insert into reading.devices (user_id, device_id, label) values (${owner}, ${randomUUID()}, 'forged')`)
        .catch((error: unknown) => {
          forgedDeviceCode = pgCode(error);
        });
      assert("S15", forgedDeviceCode === "42501", `sqlstate = ${forgedDeviceCode ?? "none"}`);

      // No `where`, no `returning`: a column reference would bring the SELECT
      // policy in and hide what the UPDATE policy's own `using` lets through.
      let touched: number | undefined;
      let touchCode: string | undefined;
      await tx
        .savepoint(async (sp) => {
          touched = (await sp`update reading.devices set last_seen_at = now()`).count;
        })
        .catch((error: unknown) => {
          touchCode = pgCode(error);
        });
      assert("S16", touchCode === undefined && touched === 0, `rows updated = ${touched ?? "n/a"}, sqlstate = ${touchCode ?? "none"}`);

      await enterUserContext(tx, owner);
      const reader = readerTx(tx);
      const garbled = decodeCursor("x|y|1");
      const legible = decodeCursor(`2026-10-08T12:00:00.123456Z|${deviceA}|7`);
      const impossible = decodeCursor(`2026-02-31T12:00:00Z|${deviceA}|7`);
      await writeUpload(reader, owner, deviceB, "chrome:android", rowsOf(deviceB, [1, 2, 3]));
      let everything = "not run" as number | string;
      await tx
        .savepoint(async (sp) => {
          everything = (await downloadRows(readerTx(sp), garbled, deviceA)).length;
        })
        .catch((error: unknown) => {
          everything = `sqlstate ${pgCode(error) ?? String(error)}`;
        });
      assert(
        "S17",
        garbled === null && impossible === null && legible?.localId === 7 && everything === 3,
        `x|y|1 -> ${garbled === null ? "null" : "a cursor"}, 31 February -> ${impossible}, legible kept = ${legible !== null}, full download = ${everything}`,
      );

      const wire = (at: number) => ({ deviceId: deviceA, readerId: "reader", rows: [{ ...rowsOf(deviceA, [1])[0], at }], since: null });
      assert(
        "S18",
        !syncRequestSchema.safeParse(wire(9e15)).success && syncRequestSchema.safeParse(wire(1_700_000_000_000)).success,
        `9e15 refused = ${!syncRequestSchema.safeParse(wire(9e15)).success}`,
      );

      // Aged to 2000 by hand: `now()` is constant inside a transaction, so a
      // refreshed `last_seen_at` is only visible against an older one.
      const age = (device: string) =>
        tx`update reading.devices set last_seen_at = '2000-01-01T00:00:00Z' where user_id = ${owner} and device_id = ${device}`;
      const countOwner = async () =>
        Number((await tx<{ count: string }[]>`select count(*)::text as count from reading.lookups where user_id = ${owner}`)[0].count);

      await age(deviceA);
      const before = await countOwner();
      const overQuota = await writeUpload(reader, owner, deviceA, "chrome:android", rowsOf(deviceA, [1]), before);
      const afterQuota = await countOwner();
      const sealQuota = await deviceState(tx, owner, deviceA);
      const underQuota = await writeUpload(reader, owner, deviceA, "chrome:android", rowsOf(deviceA, [1]), before + 1);
      assert(
        "S19",
        overQuota.status === "quota" && afterQuota === before && sealQuota?.seenYear === 2000 && underQuota.status === "ok",
        `over cap -> ${overQuota.status}, rows ${before} -> ${afterQuota}, seal year ${sealQuota?.seenYear}, at cap -> ${underQuota.status}`,
      );

      await tx`update reading.devices set retired_at = now() where user_id = ${owner} and device_id = ${deviceA}`;
      await age(deviceA);
      const beforeRetired = await countOwner();
      const toRetired = await writeUpload(reader, owner, deviceA, "chrome:android", rowsOf(deviceA, [2]));
      const afterRetired = await countOwner();
      const sealRetired = await deviceState(tx, owner, deviceA);
      assert(
        "S20",
        toRetired.status === "retired" && beforeRetired === afterRetired && sealRetired?.seenYear === 2000,
        `upload -> ${toRetired.status}, rows ${beforeRetired} -> ${afterRetired}, seal year ${sealRetired?.seenYear}`,
      );

      await tx`insert into reading.devices (user_id, device_id, label) values (${owner}, ${deviceC}, 'Chrome on Android')`;
      await writeUpload(reader, owner, deviceC, deviceLabel("Mozilla/5.0 (Linux; Android 14) Chrome/126.0.0.0 Mobile Safari/537.36"), []);
      const relabelled = await deviceState(tx, owner, deviceC);
      assert("S20b", relabelled?.label === "chrome:android", `label after a round = ${relabelled?.label}`);

      await tx`insert into reading.devices (user_id, device_id, label) values (${owner}, ${deviceD}, 'chrome:android')`;
      await writeUpload(reader, owner, deviceD, "chrome:android", rowsOf(deviceD, [1, 2]));
      const siblingBefore = (await tx`select 1 from reading.lookups where user_id = ${owner} and device_id = ${deviceB}`).length;
      const gone = await retireDevice(reader, owner, deviceD);
      const retiredRow = await deviceState(tx, owner, deviceD);
      const [{ count: leftOnD }] = await tx<{ count: string }[]>`select count(*)::text as count from reading.lookups where user_id = ${owner} and device_id = ${deviceD}`;
      const siblingAfter = (await tx`select 1 from reading.lookups where user_id = ${owner} and device_id = ${deviceB}`).length;
      const listed = (await listDevices(reader, owner)).map((device) => device.deviceId);
      let second = "not run" as number | string;
      await tx
        .savepoint(async (sp) => {
          second = (await retireDevice(readerTx(sp), owner, deviceD)).lookups;
        })
        .catch((error: unknown) => {
          second = `sqlstate ${pgCode(error) ?? String(error)}`;
        });
      const neverSealed = randomUUID();
      const ghost = await retireDevice(reader, owner, neverSealed);
      const ghostUpload = await writeUpload(reader, owner, neverSealed, "chrome:android", rowsOf(neverSealed, [1]));
      assert(
        "S21",
        gone.lookups === 2 && retiredRow?.retired === true && leftOnD === "0" && siblingBefore === siblingAfter &&
          !listed.includes(deviceD) && listed.includes(deviceC) && second === 0 && ghost.lookups === 0 &&
          ghostUpload.status === "retired",
        `retired ${gone.lookups} rows, row kept retired = ${retiredRow?.retired}, left = ${leftOnD}, sibling ${siblingBefore} -> ${siblingAfter}, listed = ${listed.length}, second call = ${second}, never-sealed = ${ghost.lookups}/${ghostUpload.status}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  // S22: two uploads at once, each alone within the cap and together past it.
  // The first holds its transaction open while the second waits on the quota
  // lock, so the second counts only after the first commits. It needs real
  // commits, so its reader is a committed row this block deletes at the end
  // (the cascade takes the devices and lookups with it).
  const racer = randomUUID();
  const racerEmail = `harness-reader-${racer}@example.invalid`;
  const raceCap = 2;
  const race = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3, connection: { search_path: "reading, public" } });
  try {
    const run = await openRun("rls", race);
    await race.begin(async (tx) => {
      await tx`insert into auth.users (id, email) values (${racer}, ${racerEmail})`;
      await tx`insert into harness.identities (user_id, run_id, email, disposition)
        values (${racer}, ${run}, ${racerEmail}, 'ephemeral')`;
    });
    const firstDevice = randomUUID();
    const secondDevice = randomUUID();

    let firstHolds!: (status: string) => void;
    const firstWrote = new Promise<string>((resolve) => (firstHolds = resolve));
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => (releaseFirst = resolve));

    const first = race.begin(async (tx) => {
      await enterUserContext(tx, racer);
      const upload = await writeUpload(readerTx(tx), racer, firstDevice, "chrome:android", rowsOf(firstDevice, [1, 2]), raceCap);
      firstHolds(upload.status);
      await firstReleased;
    });
    // A first upload that throws must not leave this block waiting on a signal nobody sends.
    first.catch((error: unknown) => firstHolds(`threw ${pgCode(error) ?? String(error)}`));
    const firstStatus = await firstWrote;

    let secondDone = false;
    const second = race
      .begin(async (tx) => {
        await enterUserContext(tx, racer);
        return writeUpload(readerTx(tx), racer, secondDevice, "chrome:android", rowsOf(secondDevice, [1, 2]), raceCap);
      })
      .finally(() => {
        secondDone = true;
      });

    // Until the second statement is queued on an advisory lock, or has already
    // finished because nothing made it wait. Bounded: never a retry.
    let waited = false;
    for (let attempt = 0; attempt < 100 && !waited && !secondDone; attempt += 1) {
      const [{ count }] = await race<{ count: string }[]>`
        with quota as (select hashtextextended(${racer}::text || ':sync-quota', 0) as key)
        select count(*)::text as count from pg_locks, quota
        where locktype = 'advisory' and not granted and objsubid = 1
          and database = (select oid from pg_database where datname = current_database())
          and classid::bigint = (quota.key >> 32) & 4294967295
          and objid::bigint = quota.key & 4294967295`;
      waited = count !== "0";
      if (!waited) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    releaseFirst();
    await first;
    const secondUpload = await second;

    const [{ count: raced }] = await race<{ count: string }[]>`
      select count(*)::text as count from reading.lookups where user_id = ${racer}`;
    assert(
      "S22",
      firstStatus === "ok" && waited && secondUpload.status === "quota" && raced === String(raceCap),
      `first -> ${firstStatus}, second waited on the lock = ${waited}, second -> ${secondUpload.status}, rows ${raced} for a cap of ${raceCap}`,
    );
  } finally {
    await race`delete from harness.identities where user_id = ${racer}`;
    await race`delete from auth.users where id = ${racer}`;
    await closeRun(race);
    await race.end();
  }

  // S23-S28 need statements that do not share one `now()`, so their reader is a
  // committed row this block deletes at the end (the cascade takes its devices
  // and lookups with it). Setup runs as the connection's own role; every call
  // under test runs under the reader's settled one.
  const late = randomUUID();
  const lateEmail = `harness-reader-${late}@example.invalid`;
  const lateDb = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3, connection: { search_path: "reading, public" } });
  const asReader = <T>(work: (reader: Transaction) => Promise<T>): Promise<T> =>
    lateDb.begin(async (tx) => {
      await enterUserContext(tx, late);
      return work(readerTx(tx));
    }) as Promise<T>;
  try {
    const run = await openRun("rls", lateDb);
    await lateDb.begin(async (tx) => {
      await tx`insert into auth.users (id, email) values (${late}, ${lateEmail})`;
      await tx`insert into harness.identities (user_id, run_id, email, disposition)
        values (${late}, ${run}, ${lateEmail}, 'ephemeral')`;
    });

    // S23: the list runs from the most recent device to the oldest.
    const [oldest, middle, newest] = [randomUUID(), randomUUID(), randomUUID()];
    await lateDb`insert into reading.devices (user_id, device_id, label, last_seen_at) values
      (${late}, ${middle}, 'chrome:android', '2020-01-01T00:00:00Z'),
      (${late}, ${newest}, 'chrome:android', '2030-01-01T00:00:00Z'),
      (${late}, ${oldest}, 'chrome:android', '2010-01-01T00:00:00Z')`;
    const listedOrder = (await asReader((reader) => listDevices(reader, late))).map((device) => device.deviceId);
    assert(
      "S23",
      listedOrder.join() === [newest, middle, oldest].join(),
      `listed newest-first = ${listedOrder.join() === [newest, middle, oldest].join()}, count = ${listedOrder.length}`,
    );

    // S24: a device that copied nothing counts 0, not null.
    const listedNone = (await asReader((reader) => listDevices(reader, late))).find((device) => device.deviceId === middle);
    assert("S24", listedNone?.lookups === 0, `lookups of a device with no searches = ${String(listedNone?.lookups)}`);

    // S25: two retirements in two transactions; the second neither throws nor moves the instant.
    const retiredTwice = randomUUID();
    await lateDb`insert into reading.devices (user_id, device_id, label) values (${late}, ${retiredTwice}, 'chrome:android')`;
    const retiredAt = async () =>
      (await lateDb<{ at: string }[]>`select retired_at::text as at from reading.devices where user_id = ${late} and device_id = ${retiredTwice}`)[0]?.at;
    await asReader((reader) => retireDevice(reader, late, retiredTwice));
    const firstInstant = await retiredAt();
    let secondRetire = "not run" as number | string;
    await asReader((reader) => retireDevice(reader, late, retiredTwice)).then(
      (result) => {
        secondRetire = result.lookups;
      },
      (error: unknown) => {
        secondRetire = `sqlstate ${pgCode(error) ?? String(error)}`;
      },
    );
    const secondInstant = await retiredAt();
    assert(
      "S25",
      firstInstant !== undefined && secondRetire === 0 && secondInstant === firstInstant,
      `second retirement = ${secondRetire}, retired_at kept = ${secondInstant === firstInstant}`,
    );

    // S26: a round whose statement began before the device was retired, and
    // reaches the seal after the retirement commits, leaves the device alone.
    // The retirement holds the row's lock open; the round waits on it.
    const sealed = randomUUID();
    await lateDb`insert into reading.devices (user_id, device_id, label, last_seen_at)
      values (${late}, ${sealed}, 'chrome:android', '2000-01-01T00:00:00Z')`;
    let retirementHolds!: () => void;
    const retirementWrote = new Promise<void>((resolve) => (retirementHolds = resolve));
    let releaseRetirement!: () => void;
    const retirementReleased = new Promise<void>((resolve) => (releaseRetirement = resolve));
    const retirement = lateDb.begin(async (tx) => {
      await enterUserContext(tx, late);
      await retireDevice(readerTx(tx), late, sealed);
      retirementHolds();
      await retirementReleased;
    });
    retirement.catch(() => retirementHolds());
    await retirementWrote;

    let roundDone = false;
    const round = asReader((reader) => writeUpload(reader, late, sealed, "firefox:linux", [])).then(
      () => "done",
      (error: unknown) => `sqlstate ${pgCode(error) ?? String(error)}`,
    ).finally(() => {
      roundDone = true;
    });
    let roundWaited = false;
    for (let attempt = 0; attempt < 100 && !roundWaited && !roundDone; attempt += 1) {
      const [{ count }] = await lateDb<{ count: string }[]>`
        select count(*)::text as count from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'transactionid'
          and query like '%sealed as%' and query like '%sync_rows_today%'`;
      roundWaited = count !== "0";
      if (!roundWaited) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    releaseRetirement();
    await retirement;
    const roundResult = await round;
    const [afterRound] = await lateDb<{ label: string; seen_year: number; retired: boolean }[]>`
      select label, extract(year from last_seen_at)::int as seen_year, retired_at is not null as retired
      from reading.devices where user_id = ${late} and device_id = ${sealed}`;
    assert(
      "S26",
      roundWaited && afterRound.retired && afterRound.label === "chrome:android" && afterRound.seen_year === 2000,
      `round waited on the retirement = ${roundWaited}, round -> ${roundResult}, label = ${afterRound.label}, last seen year = ${afterRound.seen_year}`,
    );

    // S27/S28: three rows that share one `received_at`, written against the
    // order they must come back in.
    const [lowDevice, highDevice] = [randomUUID(), randomUUID()].sort();
    const viewer = randomUUID();
    await asReader(async (reader) => {
      await writeUpload(reader, late, highDevice, "chrome:android", rowsOf(highDevice, [2, 1]));
      await writeUpload(reader, late, lowDevice, "chrome:android", rowsOf(lowDevice, [1]));
    });
    await lateDb`update reading.lookups set received_at = '2031-01-01T00:00:00Z'
      where user_id = ${late} and device_id in (${lowDevice}, ${highDevice})`;
    const downloaded = await asReader((reader) => downloadRows(reader, null, viewer));
    const keys = downloaded.map((row) => `${row.device_id}:${row.local_id}`);
    const expectedKeys = [`${lowDevice}:1`, `${highDevice}:1`, `${highDevice}:2`];
    assert("S27", keys.join() === expectedKeys.join(), `order = ${keys.map((key) => key.slice(0, 4) + key.slice(36)).join()}`);

    const last = downloaded[downloaded.length - 1];
    const atEnd = last && decodeCursor(`${last.received_at}Z|${last.device_id}|${last.local_id}`);
    const afterLast = atEnd ? await asReader((reader) => downloadRows(reader, atEnd, viewer)) : undefined;
    assert("S28", afterLast?.length === 0, `rows after a cursor on the last row = ${afterLast?.length ?? "no cursor"}`);

    // S29: a word the network answered travels like any other row.
    const unlistedDevice = randomUUID();
    const [unlistedRow] = rowsOf(unlistedDevice, [1]).map((row) => syncRowSchema.parse({ ...row, outcome: "unlisted" }));
    await asReader((reader) => writeUpload(reader, late, unlistedDevice, "chrome:android", [unlistedRow]));
    const sent = await asReader((reader) => downloadRows(reader, null, viewer));
    const back = sent.find((row) => row.device_id === unlistedDevice);
    assert("S29", back?.outcome === "unlisted", `outcome of the row another device downloads = ${back?.outcome ?? "none"}`);

    // S30/S31: the route itself. The answer of the network travels up from one
    // device and down to another; a client that predates the fields still enters.
    sessionStub.readerId = late;
    sessionStub.run = (work) => asReader(work);
    const { POST } = await import("../app/api/log/sync/route");
    const post = async (body: unknown) => {
      const response = await POST(new Request("http://localhost/api/log/sync", { method: "POST", body: JSON.stringify({ readerId: late, ...(body as object) }) }));
      return { status: response.status, json: (await response.json()) as { rows: Record<string, unknown>[] } };
    };
    const [phone, laptop] = [randomUUID(), randomUUID()];
    const answered = {
      ...rowsOf(phone, [1])[0],
      outcome: "unlisted",
      definition: "d".repeat(500),
      exampleEn: "An example.",
      exampleEs: "Un ejemplo.",
    };
    await post({ deviceId: phone, rows: [answered], since: null });
    const pulled = await post({ deviceId: laptop, rows: [], since: null });
    const carried = pulled.json.rows.find((wire) => wire.deviceId === phone);
    assert(
      "S30",
      pulled.status === 200 &&
        carried?.definition === answered.definition &&
        carried?.exampleEn === answered.exampleEn &&
        carried?.exampleEs === answered.exampleEs,
      `definition = ${String(carried?.definition).length} chars, example_en = ${String(carried?.exampleEn)}, example_es = ${String(carried?.exampleEs)}`,
    );

    const oldPhone = randomUUID();
    const oldClient = await post({ deviceId: oldPhone, rows: rowsOf(oldPhone, [1]), since: null });
    const pulledOld = await post({ deviceId: laptop, rows: [], since: null });
    const oldBack = pulledOld.json.rows.find((wire) => wire.deviceId === oldPhone);
    assert(
      "S31",
      oldClient.status === 200 && oldBack?.definition === null && oldBack?.exampleEn === null && oldBack?.exampleEs === null,
      `status = ${oldClient.status}, fields = ${JSON.stringify([oldBack?.definition, oldBack?.exampleEn, oldBack?.exampleEs])}`,
    );

    // S32: another reader sees none of those columns, by download or by select.
    const stranger = randomUUID();
    await lateDb.begin(async (tx) => {
      await tx`insert into auth.users (id, email) values (${stranger}, ${`harness-reader-${stranger}@example.invalid`})`;
      await tx`insert into harness.identities (user_id, run_id, email, disposition)
        values (${stranger}, ${run}, ${`harness-reader-${stranger}@example.invalid`}, 'ephemeral')`;
    });
    try {
      const strangerSees = await lateDb.begin(async (tx) => {
        await enterUserContext(tx, stranger);
        const downloaded = await downloadRows(readerTx(tx), null, randomUUID());
        const selected = await tx`select definition, example_en, example_es from reading.lookups
          where definition is not null or example_en is not null or example_es is not null`;
        return { downloaded: downloaded.length, selected: selected.length };
      });
      assert(
        "S32",
        strangerSees.downloaded === 0 && strangerSees.selected === 0,
        `rows another reader downloads = ${strangerSees.downloaded}, selects = ${strangerSees.selected}`,
      );
    } finally {
      await lateDb`delete from harness.identities where user_id = ${stranger}`;
      await lateDb`delete from auth.users where id = ${stranger}`;
    }
  } finally {
    await lateDb`delete from harness.identities where user_id = ${late}`;
    await lateDb`delete from auth.users where id = ${late}`;
    await closeRun(lateDb);
    await lateDb.end();
  }

  // S33-S42 (RL-66, RL-70, RNL-10): a round deletes the searches it names, marks them,
  // refuses their return and hands the marks to every device. Each scenario owns a
  // committed reader (real commits: a mark's `deleted_at` must differ from a row's
  // `received_at`), deleted at the end; the cascade takes everything it wrote.
  type Wire = {
    status: number;
    json: {
      accepted: number;
      rows: { deviceId: string; localId: number }[];
      tombstones: { deviceId: string; localId: number }[];
      tombstoneCursor: string | null;
    };
  };
  const tombRun = await openRun("rls", sql);
  const scenario = async (
    work: (ctx: {
      reader: string;
      db: postgres.Sql;
      as: <T>(who: string, fn: (tx: Transaction) => Promise<T>) => Promise<T>;
      post: (who: string, body: Record<string, unknown>) => Promise<Wire>;
      ids: (device: string) => Promise<number[]>;
      marks: (device: string) => Promise<number[]>;
    }) => Promise<void>,
  ): Promise<void> => {
    const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3, connection: { search_path: "reading, public" } });
    const reader = randomUUID();
    const email = `harness-reader-${reader}@example.invalid`;
    await db.begin(async (tx) => {
      await tx`insert into auth.users (id, email) values (${reader}, ${email})`;
      await tx`insert into harness.identities (user_id, run_id, email, disposition) values (${reader}, ${tombRun}, ${email}, 'ephemeral')`;
    });
    const as = <T,>(who: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
      db.begin(async (tx) => {
        await enterUserContext(tx, who);
        return fn(readerTx(tx));
      }) as Promise<T>;
    const { POST } = await import("../app/api/log/sync/route");
    const post = async (who: string, body: Record<string, unknown>): Promise<Wire> => {
      sessionStub.readerId = who;
      sessionStub.run = (fn) => as(who, fn);
      // A route that throws is a 500 to the device, and a red here rather than a crash of the whole script.
      const response = await POST(
        new Request("http://localhost/api/log/sync", { method: "POST", body: JSON.stringify({ readerId: who, ...body }) }),
      ).catch(() => Response.json({}, { status: 500 }));
      return { status: response.status, json: (await response.json()) as Wire["json"] };
    };
    const ids = async (device: string) =>
      (await db<{ local_id: number }[]>`select local_id from reading.lookups where user_id = ${reader} and device_id = ${device} order by local_id`).map((r) => r.local_id);
    const marks = async (device: string) =>
      (await db<{ local_id: number }[]>`select local_id from reading.lookup_tombstones where user_id = ${reader} and device_id = ${device} order by local_id`).map((r) => r.local_id);
    try {
      await work({ reader, db, as, post, ids, marks });
    } finally {
      await db`delete from harness.identities where user_id = ${reader}`;
      await db`delete from auth.users where id = ${reader}`;
      await db.end();
    }
  };
  const keyOf = (tombstone: { deviceId: string; localId: number }) => `${tombstone.deviceId}:${tombstone.localId}`;

  // S33-S35: a named search leaves the account with its mark; the mark keeps the row's own
  // `received_at`; naming a search that was never uploaded marks nothing.
  await scenario(async ({ reader, db, as, post, ids, marks }) => {
    const [a, viewer] = [randomUUID(), randomUUID()];
    await as(reader, (tx) => writeUpload(tx, reader, a, "chrome:android", rowsOf(a, [1, 2, 3])));
    await db`update reading.lookups set received_at = '2020-05-05T05:05:05.123456Z'
      where user_id = ${reader} and device_id = ${a} and local_id = 2`;
    const sent = await as(reader, (tx) =>
      writeUpload(tx, reader, a, "chrome:android", [], undefined, [{ deviceId: a, localId: 2 }, { deviceId: a, localId: 9 }], null),
    );
    const left = await ids(a);
    const [mark] = await db<{ received_at: string }[]>`
      select received_at::text as received_at from reading.lookup_tombstones
      where user_id = ${reader} and device_id = ${a} and local_id = 2`;
    const buried = sent.status === "ok" ? (sent as { buried?: number }).buried : undefined;
    assert("S33", sent.status === "ok" && left.join() === "1,3" && buried === 1, `status = ${sent.status}, lookups left = ${left.join()}, buried = ${String(buried)}`);
    assert("S34", mark?.received_at === "2020-05-05 05:05:05.123456+00", `mark received_at = ${mark?.received_at}`);
    const markedIds = await marks(a);
    assert("S35", markedIds.join() === "2", `marks = ${markedIds.join()} (the never-uploaded (A,9) must not be one)`);

    const pulled = await post(reader, { deviceId: viewer, rows: [], since: null });
    const pulledIds = pulled.json.rows.map((row) => row.localId).sort();
    assert("S33b", pulled.status === 200 && pulledIds.join() === "1,3", `rows a second device downloads = ${pulledIds.join()}`);
  });

  // S36: a marked search sent again is skipped; the rest of the batch is stored; no 500.
  await scenario(async ({ reader, post, ids }) => {
    const [a, b] = [randomUUID(), randomUUID()];
    await post(reader, { deviceId: a, rows: rowsOf(a, [1, 2, 3]), since: null });
    await post(reader, { deviceId: b, rows: [], since: null, tombstones: [{ deviceId: a, localId: 2 }], tombstonesSince: null });
    const again = await post(reader, { deviceId: a, rows: rowsOf(a, [2, 4]), since: null });
    const left = await ids(a);
    assert(
      "S36",
      again.status === 200 && again.json.accepted === 1 && left.join() === "1,3,4",
      `status = ${again.status}, accepted = ${again.json.accepted}, lookups = ${left.join()}`,
    );
  });

  // S37: another reader's search is never buried; the same identity of his own is.
  await scenario(async ({ reader, db, as, post }) => {
    const intruderId = randomUUID();
    const intruderEmail = `harness-reader-${intruderId}@example.invalid`;
    await db.begin(async (tx) => {
      await tx`insert into auth.users (id, email) values (${intruderId}, ${intruderEmail})`;
      await tx`insert into harness.identities (user_id, run_id, email, disposition) values (${intruderId}, ${tombRun}, ${intruderEmail}, 'ephemeral')`;
    });
    try {
      const shared = randomUUID();
      await as(reader, (tx) => writeUpload(tx, reader, shared, "chrome:android", rowsOf(shared, [1])));
      await as(intruderId, (tx) => writeUpload(tx, intruderId, shared, "chrome:android", rowsOf(shared, [1])));
      const round = await post(intruderId, { deviceId: shared, rows: [], since: null, tombstones: [{ deviceId: shared, localId: 1 }], tombstonesSince: null });
      const count = async (table: string, user: string) =>
        (await db.unsafe<{ count: string }[]>(`select count(*)::text as count from reading.${table} where user_id = $1`, [user]))[0].count;
      const seen = [await count("lookups", reader), await count("lookup_tombstones", reader), await count("lookups", intruderId)];
      assert(
        "S37",
        round.status === 200 && seen.join() === "1,0,0",
        `status = ${round.status}, owner rows / owner marks / intruder's own row = ${seen.join()}`,
      );
    } finally {
      await db`delete from harness.identities where user_id = ${intruderId}`;
      await db`delete from auth.users where id = ${intruderId}`;
    }
  });

  // S38: 501 marks written by one statement tie on `deleted_at`; two pages carry all of
  // them once, in `(deleted_at, device_id, local_id)` order.
  await scenario(async ({ reader, as, post }) => {
    const [low, high] = [randomUUID(), randomUUID()].sort();
    const viewer = randomUUID();
    const lowIds = Array.from({ length: 300 }, (_, i) => i + 1);
    const highIds = Array.from({ length: 201 }, (_, i) => i + 1);
    await as(reader, (tx) => writeUpload(tx, reader, low, "chrome:android", rowsOf(low, lowIds)));
    await as(reader, (tx) => writeUpload(tx, reader, high, "chrome:android", rowsOf(high, highIds)));
    const all = [...lowIds.map((localId) => ({ deviceId: low, localId })), ...highIds.map((localId) => ({ deviceId: high, localId }))];
    await as(reader, (tx) => writeUpload(tx, reader, viewer, "chrome:android", [], undefined, all, null));
    const first = await post(reader, { deviceId: viewer, rows: [], since: null, tombstones: [], tombstonesSince: null });
    const second = await post(reader, { deviceId: viewer, rows: [], since: null, tombstones: [], tombstonesSince: first.json.tombstoneCursor });
    const pageOne = first.json.tombstones ?? [];
    const pageTwo = second.json.tombstones ?? [];
    const keys = [...pageOne, ...pageTwo].map(keyOf);
    const inOrder = keys.join() === all.map(keyOf).join();
    assert(
      "S38",
      pageOne.length === 500 && pageTwo.length === 1 && new Set(keys).size === 501 && inOrder,
      `pages = ${pageOne.length} + ${pageTwo.length}, distinct = ${new Set(keys).size}, in tuple order = ${inOrder}`,
    );
  });

  // S39/S40: a retired device, or a day past the cap, buries nothing.
  await scenario(async ({ reader, db, as, post, ids, marks }) => {
    const [a, retired] = [randomUUID(), randomUUID()];
    await as(reader, (tx) => writeUpload(tx, reader, a, "chrome:android", rowsOf(a, [1, 2])));
    await db`insert into reading.devices (user_id, device_id, label, retired_at) values (${reader}, ${retired}, 'chrome:android', now())`;
    const refused = await post(reader, { deviceId: retired, rows: [], since: null, tombstones: [{ deviceId: a, localId: 1 }], tombstonesSince: null });
    const afterRetired = [(await ids(a)).join(), (await marks(a)).length] as const;
    const over = await as(reader, (tx) => writeUpload(tx, reader, a, "chrome:android", rowsOf(a, [7]), 0, [{ deviceId: a, localId: 1 }], null));
    const afterCap = [(await ids(a)).join(), (await marks(a)).length] as const;
    // The control: the same name, from a live device within the cap, does bury, so the two
    // refusals above are the gate's and not an inert statement's.
    const live = randomUUID();
    const control = await post(reader, { deviceId: live, rows: [], since: null, tombstones: [{ deviceId: a, localId: 1 }], tombstonesSince: null });
    const buriedByControl = control.status === 200 && (await ids(a)).join() === "2" && (await marks(a)).join() === "1";
    assert("S39", refused.status === 409 && afterRetired[0] === "1,2" && afterRetired[1] === 0 && buriedByControl, `status = ${refused.status}, lookups = ${afterRetired[0]}, marks = ${afterRetired[1]}, control buries = ${buriedByControl}`);
    assert("S40", over.status === "quota" && afterCap[0] === "1,2" && afterCap[1] === 0 && buriedByControl, `status = ${over.status}, lookups = ${afterCap[0]}, marks = ${afterCap[1]}, control buries = ${buriedByControl}`);
  });

  // S41/S42: a body written before the fields existed still enters and is answered with both
  // fields; marks come down to a device that has not seen them, and the cursor resumes after.
  await scenario(async ({ reader, db, post }) => {
    const [a, other] = [randomUUID(), randomUUID()];
    const oldBody = await post(reader, { deviceId: a, rows: rowsOf(a, [1, 2]), since: null });
    assert(
      "S41",
      oldBody.status === 200 && Array.isArray(oldBody.json.tombstones) && oldBody.json.tombstones.length === 0 && oldBody.json.tombstoneCursor === null,
      `status = ${oldBody.status}, tombstones = ${JSON.stringify(oldBody.json.tombstones)}, tombstoneCursor = ${String(oldBody.json.tombstoneCursor)}`,
    );
    await post(reader, { deviceId: a, rows: [], since: null, tombstones: [{ deviceId: a, localId: 2 }], tombstonesSince: null });
    const [stamped] = await db<{ at: string }[]>`
      select to_json(timezone('utc', deleted_at))::text as at from reading.lookup_tombstones where user_id = ${reader} and local_id = 2`;
    const down = await post(reader, { deviceId: other, rows: [], since: null, tombstones: [], tombstonesSince: null });
    const cursor = down.json.tombstoneCursor ? decodeCursor(down.json.tombstoneCursor) : null;
    assert(
      "S42",
      (down.json.tombstones ?? []).map(keyOf).join() === `${a}:2` && cursor?.deviceId === a && cursor.localId === 2 && stamped !== undefined && cursor.receivedAt === `${JSON.parse(stamped.at) as string}Z`,
      `marks = ${(down.json.tombstones ?? []).map(keyOf).join()}, cursor = ${String(down.json.tombstoneCursor)}`,
    );
    const resumed = await post(reader, { deviceId: other, rows: [], since: null, tombstones: [], tombstonesSince: down.json.tombstoneCursor });
    assert(
      "S42b",
      typeof down.json.tombstoneCursor === "string" && (resumed.json.tombstones ?? []).length === 0 && resumed.json.tombstoneCursor === down.json.tombstoneCursor,
      `marks after the cursor = ${(resumed.json.tombstones ?? []).length}, cursor kept = ${resumed.json.tombstoneCursor === down.json.tombstoneCursor}`,
    );
  });

  await checkRolledBackRounds();
  await sql.end();
  if (failed) process.exit(1);
}

main();
