import "server-only";

import { sql } from "drizzle-orm";

import { measureOf } from "@/lib/day/derive";
import type { Cadence, DeclaredFact, Phase, SatisfiedBy } from "@/lib/day/types";
import { withGoalsDb, type Transaction } from "@/lib/session";

type GoalRow = {
  id: string;
  name: string;
  horizon: string;
  measure_name: string | null;
  measure_unit: string | null;
};

// `source_unit` and `source_label_key` ride in from the join to
// `evidence_sources`; the goal's own screen names no evidence to fan out for
// (loadGoal opens no reading transaction, RP-05), so `source_label_key` is
// the only way it can ever say which source an evidence commitment names
// (RP-09) — a catalogue key, never a sentence (RNP-01).
type CommitmentRow = {
  id: string;
  name: string;
  cadence_kind: Cadence["kind"];
  cadence_n: number | null;
  cadence_weekdays: number[] | null;
  satisfaction: SatisfiedBy["kind"];
  target_quantity: number | null;
  unit: string | null;
  threshold: number | null;
  retired_at: string | null;
  created_at: string;
  source_unit: string | null;
  source_label_key: string | null;
};

type PhaseRow = {
  id: string;
  aim: string;
  starts_on: string;
  ends_on: string | null;
};

// `commitment_unit` rides in from the join to `commitments`: a fact carries a
// bare quantity, never its own unit.
type FactRow = {
  commitment_id: string | null;
  day: string;
  written_at: string;
  quantity: number | null;
  note: string | null;
  commitment_unit: string | null;
};

// One statement's whole shape: the goal itself (`null` when the id does not
// resolve under RLS — deleted, or somebody else's), every phase and every
// commitment it has ever had, and every fact that names it — retired
// commitments and old facts included, since a goal's screen never hides what
// it once asked for (RP-13).
type GoalQueryRow = {
  goal: GoalRow | null;
  phases: PhaseRow[];
  commitments: CommitmentRow[];
  facts: FactRow[];
};

// What a commitment reads as on the goal's own screen: its cadence and what
// satisfies it, in the engine's own shapes, plus its name and its retirement
// — drawn, never hidden (RP-13). A view of its own rather than
// `CommitmentPlan`: the goal's screen has no day to ask `asksOn` against.
export type GoalCommitment = {
  id: string;
  name: string;
  cadence: Cadence;
  satisfiedBy: SatisfiedBy;
  retiredAt: string | null;
  // The evidence source's own catalogue key (RNP-01), set only when
  // `satisfiedBy.kind === "evidence"` — the goal's screen reads the source's
  // name from `sources.json` under this key, never a sentence stored here.
  sourceLabelKey: string | null;
};

export type GoalView = {
  id: string;
  name: string;
  horizon: string;
  measureName: string | null;
  measureUnit: string | null;
  // A sum over facts, computed here and never read from a column (RP-14):
  // `goals.goals` has no place to hold one, and the grant layer refuses a
  // write to any column that would.
  measureTotal: number;
  phases: Phase[];
  commitments: GoalCommitment[];
};

export type GoalSummary = {
  id: string;
  name: string;
  horizon: string;
  measureName: string | null;
  measureUnit: string | null;
};

/**
 * One statement, four subqueries: the goal row scoped by id, and every phase,
 * commitment and fact that name it — unfiltered by `retired_at` or by day, so
 * a goal's screen reads its whole history in the one round trip. RLS alone
 * narrows every row to the caller's own (RNP-05); `goalId` alone would let a
 * caller read a goal id they merely guessed, so `goal` still comes back
 * `null` when it is not theirs.
 */
async function queryGoalRow(tx: Transaction, goalId: string): Promise<GoalQueryRow> {
  const [row] = await tx.execute<GoalQueryRow>(sql`
    select
      (select to_jsonb(g) from "goals"."goals" g where g.id = ${goalId}) as goal,
      (select coalesce(json_agg(to_jsonb(p)), '[]'::json)
         from "goals"."phases" p
         where p.goal_id = ${goalId}) as phases,
      (select coalesce(json_agg(to_jsonb(c) || jsonb_build_object(
                 'source_unit', s.unit,
                 'source_label_key', s.label_key
               )), '[]'::json)
         from "goals"."commitments" c
         left join "goals"."evidence_sources" s on s.id = c.source_id
         where c.goal_id = ${goalId}) as commitments,
      (select coalesce(json_agg(to_jsonb(f) || jsonb_build_object(
                 'commitment_unit', c.unit
               )), '[]'::json)
         from "goals"."facts" f
         left join "goals"."commitments" c on c.id = f.commitment_id
         where f.goal_id = ${goalId}) as facts
  `);

  return row;
}

function toCadence(row: CommitmentRow): Cadence {
  switch (row.cadence_kind) {
    case "daily":
      return { kind: "daily" };
    case "weekdays":
      return { kind: "weekdays", days: row.cadence_weekdays ?? [] };
    case "times_per_week":
      return { kind: "times_per_week", count: row.cadence_n ?? 0 };
    case "every_n_days":
      return { kind: "every_n_days", n: row.cadence_n ?? 1, anchor: row.created_at.slice(0, 10) };
    case "times_per_month":
      return { kind: "times_per_month", count: row.cadence_n ?? 0 };
  }
}

function toSatisfiedBy(row: CommitmentRow): SatisfiedBy {
  switch (row.satisfaction) {
    case "tap":
      return { kind: "tap" };
    case "quantity":
      return { kind: "quantity", target: row.target_quantity ?? 0, unit: row.unit ?? "" };
    case "evidence":
      return { kind: "evidence", threshold: row.threshold ?? 1, unit: row.source_unit ?? "" };
  }
}

function toGoalCommitment(row: CommitmentRow): GoalCommitment {
  return {
    id: row.id,
    name: row.name,
    cadence: toCadence(row),
    satisfiedBy: toSatisfiedBy(row),
    retiredAt: row.retired_at,
    sourceLabelKey: row.satisfaction === "evidence" ? row.source_label_key : null,
  };
}

function toPhase(row: PhaseRow): Phase {
  return { id: row.id, name: row.aim, startsOn: row.starts_on, endsOn: row.ends_on };
}

function toDeclaredFact(row: FactRow & { commitment_id: string }): DeclaredFact {
  return {
    commitmentId: row.commitment_id,
    day: row.day,
    writtenAt: row.written_at,
    quantity: row.quantity,
    unit: row.commitment_unit,
    note: row.note,
  };
}

/**
 * One transaction, one statement — the goal's own screen names no other
 * app's evidence to fan out for (evidence never produces a fact, RP-05, so
 * `measureOf` below only ever sums declared quantities): `withGoalsDb` throws
 * on its own, before any connection is taken, when the session is missing.
 * This throws for a goal id RLS will not resolve, the same convention as
 * that missing-session case.
 */
export async function loadGoal(goalId: string): Promise<GoalView> {
  const row = await withGoalsDb((tx) => queryGoalRow(tx, goalId));
  if (!row.goal) throw new Error("loadGoal called with an unknown goal");

  const phases = row.phases.map(toPhase);
  const commitments = row.commitments.map(toGoalCommitment);
  // A one-off's fact carries no `commitment_id`, and no unit to feed the
  // measure with; only a commitment's own quantity ever can (RP-14).
  const facts = row.facts
    .filter((fact): fact is FactRow & { commitment_id: string } => fact.commitment_id !== null)
    .map(toDeclaredFact);

  // Null until the first quantity commitment names it (§0.3, 3): nothing to
  // sum into yet, so the total stays zero rather than matching facts with no
  // unit of their own against a measure the goal does not have.
  const measureTotal = row.goal.measure_unit ? measureOf(row.goal.measure_unit, facts) : 0;

  return {
    id: row.goal.id,
    name: row.goal.name,
    horizon: row.goal.horizon,
    measureName: row.goal.measure_name,
    measureUnit: row.goal.measure_unit,
    measureTotal,
    phases,
    commitments,
  };
}

/**
 * One transaction, one statement: every goal the person has open, for the
 * day screen's grouping and for `/metas`. This slice never closes a goal
 * (RP-06/17/21 are out of it), so "open" is every row RLS hands back.
 */
export async function listGoals(): Promise<GoalSummary[]> {
  const rows = await withGoalsDb((tx) =>
    tx.execute<GoalRow>(sql`
      select id, name, horizon, measure_name, measure_unit
      from "goals"."goals"
      order by created_at
    `),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    horizon: row.horizon,
    measureName: row.measure_name,
    measureUnit: row.measure_unit,
  }));
}
