// Drives `setMonthBudget` and `removeMonthBudget` (`app/actions/budgets.ts`,
// RP-28) the way `scripts/check-goal-actions.ts` drives `plan.ts`: the
// actions imported as plain async functions, `server-only`, `next/headers`
// and `next/cache` stubbed before the first `@/` import, and the cookie
// `harness:mint-session` left standing is the session `getPerson()` reads.
// Every write goes through the actions, as `authenticated`; the pooler only
// ends one fixture goal and reads rows back.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { resolve } from "node:path";
import { after, afterEach, before, test } from "node:test";

import postgres from "postgres";

function laneNumber(): number {
  const raw = process.env.HARNESS_LANE?.trim();
  if (!raw) return 1;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`HARNESS_LANE must be a positive integer, not "${raw}"`);
  }
  return Number(raw);
}

type StoredCookie = { name: string; value: string };

function loadCookies(): StoredCookie[] {
  const file = resolve(process.cwd(), `private/session-${laneNumber()}.json`);
  let state: { cookies: StoredCookie[] };
  try {
    state = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`no session at ${file} — run harness:mint-session first`);
  }
  if (state.cookies.length === 0) {
    throw new Error(`${file} carries no cookie — the mint did not land one`);
  }
  return state.cookies.map(({ name, value }) => ({ name, value }));
}

const revalidated: string[] = [];

function installStubs(cookies: StoredCookie[]): void {
  const untyped = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = untyped._load;
  untyped._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    if (request === "next/headers") {
      return { cookies: async () => ({ getAll: () => cookies, set() {} }) };
    }
    if (request === "next/cache") {
      return { revalidatePath: (path: string) => void revalidated.push(path) };
    }
    return originalLoad(request, parent, isMain);
  };
}

let setMonthBudget: typeof import("@/app/actions/budgets").setMonthBudget;
let removeMonthBudget: typeof import("@/app/actions/budgets").removeMonthBudget;
let pgCode: typeof import("@/lib/db-error").pgCode;

// A throw names its SQLSTATE: a plain insert's change dies 23505, and the
// bare "Failed query" drizzle prints never says so.
async function settle(input: Parameters<typeof setMonthBudget>[0]) {
  try {
    return await setMonthBudget(input);
  } catch (error) {
    assert.fail(`setMonthBudget threw ${pgCode(error) ?? "without a code"}`);
  }
}

// "YYYY-MM" `delta` months from the one `day` sits in.
function monthFrom(day: string, delta: number): string {
  const index = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });

const goalIds: string[] = [];
let today: string;
let thisMonth: string;
// Measured, open, its horizon the 1st of the month after next: the month
// before that horizon is the last one it plans, the horizon's own is not.
let measuredGoalId: string;
let unmeasuredGoalId: string;
let archivedGoalId: string;
let endedGoalId: string;
// Opened two months ago, an amount planted on last month behind the action.
let agedGoalId: string;

async function rowsOf(goalId: string): Promise<{ month: string; amount: number }[]> {
  const rows = await sql<{ month: string; amount: number }[]>`
    select month::text as month, amount from goals.month_budgets
    where goal_id = ${goalId} order by month`;
  // A plain array: `postgres`'s own result class never deep-equals one.
  return rows.map(({ month, amount }) => ({ month, amount }));
}

before(async () => {
  installStubs(loadCookies());
  const plan = await import("@/app/actions/plan");
  ({ setMonthBudget, removeMonthBudget } = await import("@/app/actions/budgets"));
  ({ pgCode } = await import("@/lib/db-error"));
  const { todayInZone } = await import("@/lib/zone");
  today = todayInZone();
  thisMonth = today.slice(0, 7);
  const horizon = `${monthFrom(today, 2)}-01`;

  async function goal(name: string, measured: boolean): Promise<string> {
    const created = await plan.createGoal({ name, horizon });
    if (!created.ok) throw new Error(`createGoal: ${created.error}`);
    goalIds.push(created.goalId);
    if (measured) {
      const commitment = await plan.addCommitment({
        goalId: created.goalId,
        name: "RP-28 fixture: minutos",
        cadenceKind: "daily",
        satisfaction: "quantity",
        targetQuantity: 10,
        unit: "minutos",
      });
      if (!commitment.ok) throw new Error(`addCommitment: ${commitment.error}`);
    }
    return created.goalId;
  }

  measuredGoalId = await goal("RP-28 fixture: medida", true);
  unmeasuredGoalId = await goal("RP-28 fixture: sin medida", false);
  archivedGoalId = await goal("RP-28 fixture: archivada", true);
  endedGoalId = await goal("RP-28 fixture: terminada", true);

  for (const goalId of [archivedGoalId, endedGoalId]) {
    const planted = await setMonthBudget({ goalId, month: monthFrom(today, 1), amount: 45 });
    if (!planted.ok) throw new Error(`setMonthBudget: ${planted.error}`);
  }

  agedGoalId = await goal("RP-28 fixture: abierta hace dos meses", true);
  await sql`update goals.goals set created_at = ${`${monthFrom(today, -2)}-15T12:00:00Z`} where id = ${agedGoalId}`;
  await sql`insert into goals.month_budgets (user_id, goal_id, month, amount)
    select user_id, id, ${`${monthFrom(today, -1)}-01`}, 55 from goals.goals where id = ${agedGoalId}`;

  const archived = await plan.archiveGoal({ goalId: archivedGoalId });
  if (!archived.ok) throw new Error(`archiveGoal: ${archived.error}`);
  // No action moves a horizon onto today (`horizonRefusal` refuses it).
  await sql`update goals.goals set horizon = ${today} where id = ${endedGoalId}`;
});

after(async () => {
  // Cascades to each fixture's commitments and month amounts.
  if (goalIds.length > 0) await sql`delete from goals.goals where id in ${sql(goalIds)}`;
  await sql.end();
});

// One test's leftover row never reads as the next one's failure.
afterEach(async () => {
  for (const delta of [-1, 0, 1, 2]) {
    await removeMonthBudget({ goalId: measuredGoalId, month: monthFrom(today, delta) });
  }
});

test("setMonthBudget: an amount lands, a second one changes it in place, remove takes it away", async () => {
  revalidated.length = 0;
  const set = await settle({ goalId: measuredGoalId, month: thisMonth, amount: 720 });
  assert.deepEqual(set, { ok: true });
  assert.deepEqual(await rowsOf(measuredGoalId), [{ month: `${thisMonth}-01`, amount: 720 }]);
  for (const path of ["/", `/metas/${measuredGoalId}`, `/metas/${measuredGoalId}/meses`, `/metas/${measuredGoalId}/meses/${thisMonth}`]) {
    assert.ok(revalidated.includes(path), `revalidated: ${revalidated.join(", ")}`);
  }

  const changed = await settle({ goalId: measuredGoalId, month: thisMonth, amount: 0 });
  assert.deepEqual(changed, { ok: true });
  assert.deepEqual(await rowsOf(measuredGoalId), [{ month: `${thisMonth}-01`, amount: 0 }]);

  const removed = await removeMonthBudget({ goalId: measuredGoalId, month: thisMonth });
  assert.deepEqual(removed, { ok: true });
  assert.deepEqual(await rowsOf(measuredGoalId), []);
});

test("removeMonthBudget: a month with no amount is not a refusal", async () => {
  const removed = await removeMonthBudget({ goalId: measuredGoalId, month: monthFrom(today, 1) });
  assert.deepEqual(removed, { ok: true });
});

test("setMonthBudget: the last day's month lands; the horizon's own month is outside the span", async () => {
  const last = await settle({ goalId: measuredGoalId, month: monthFrom(today, 1), amount: 300 });
  assert.deepEqual(last, { ok: true });

  const past = await settle({ goalId: measuredGoalId, month: monthFrom(today, 2), amount: 300 });
  assert.deepEqual(past, { ok: false, error: "month.errors.outsideSpan" });
  assert.deepEqual(await rowsOf(measuredGoalId), [{ month: `${monthFrom(today, 1)}-01`, amount: 300 }]);
});

test("setMonthBudget: the month before the goal opened is closed, which is refused first", async () => {
  const result = await settle({ goalId: measuredGoalId, month: monthFrom(today, -1), amount: 60 });
  assert.deepEqual(result, { ok: false, error: "month.errors.monthClosed" });
  assert.deepEqual(await rowsOf(measuredGoalId), []);
});

test("a closed month's amount is neither changed nor removed; this month's still lands", async () => {
  const last = `${monthFrom(today, -1)}-01`;
  const set = await settle({ goalId: agedGoalId, month: monthFrom(today, -1), amount: 99 });
  assert.deepEqual(set, { ok: false, error: "month.errors.monthClosed" });
  assert.deepEqual(await rowsOf(agedGoalId), [{ month: last, amount: 55 }]);

  const removed = await removeMonthBudget({ goalId: agedGoalId, month: monthFrom(today, -1) });
  assert.deepEqual(removed, { ok: false, error: "month.errors.monthClosed" });
  assert.deepEqual(await rowsOf(agedGoalId), [{ month: last, amount: 55 }]);

  const now = await settle({ goalId: agedGoalId, month: thisMonth, amount: 70 });
  assert.deepEqual(now, { ok: true });
  assert.deepEqual(await rowsOf(agedGoalId), [
    { month: last, amount: 55 },
    { month: `${thisMonth}-01`, amount: 70 },
  ]);
});

test("setMonthBudget: a goal that measures nothing is refused with noMeasure", async () => {
  const result = await settle({ goalId: unmeasuredGoalId, month: thisMonth, amount: 60 });
  assert.deepEqual(result, { ok: false, error: "month.errors.noMeasure" });
  assert.deepEqual(await rowsOf(unmeasuredGoalId), []);
});

test("setMonthBudget: an archived goal and an ended goal are refused with closed", async () => {
  for (const goalId of [archivedGoalId, endedGoalId]) {
    const result = await settle({ goalId, month: thisMonth, amount: 60 });
    assert.deepEqual(result, { ok: false, error: "month.errors.closed" });
    assert.deepEqual(await rowsOf(goalId), [{ month: `${monthFrom(today, 1)}-01`, amount: 45 }]);
  }
});

test("setMonthBudget: a goal nobody can see is notFound; a bad amount never reaches the database", async () => {
  const missing = await settle({
    goalId: "00000000-0000-4000-8000-000000000000",
    month: thisMonth,
    amount: 60,
  });
  assert.deepEqual(missing, { ok: false, error: "month.errors.notFound" });

  const bad = await settle({ goalId: measuredGoalId, month: thisMonth, amount: 1.5 });
  assert.deepEqual(bad, { ok: false, error: "month.errors.amountInvalid" });
});

test("setMonthBudget: three writes to one month leave one row", async () => {
  for (const amount of [100, 200, 300]) {
    const result = await settle({ goalId: measuredGoalId, month: thisMonth, amount });
    assert.deepEqual(result, { ok: true });
  }
  assert.deepEqual(await rowsOf(measuredGoalId), [{ month: `${thisMonth}-01`, amount: 300 }]);
});

test("removeMonthBudget: an archived goal and an ended goal are refused with closed, their amount kept", async () => {
  const month = monthFrom(today, 1);
  // Planted while each goal was still open, so the refusal has a row to keep.
  for (const goalId of [archivedGoalId, endedGoalId]) {
    assert.deepEqual(await rowsOf(goalId), [{ month: `${month}-01`, amount: 45 }]);
    const result = await removeMonthBudget({ goalId, month });
    assert.deepEqual(result, { ok: false, error: "month.errors.closed" });
    assert.deepEqual(await rowsOf(goalId), [{ month: `${month}-01`, amount: 45 }]);
  }
});
