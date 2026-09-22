import "server-only";

import { sql } from "drizzle-orm";

import { deriveDay, type EvidenceByCommitment } from "@/lib/day/derive";
import type {
  Cadence,
  CommitmentPlan,
  DayView,
  DeclaredFact,
  EvidenceDay,
  Phase,
  SatisfiedBy,
} from "@/lib/day/types";
import { readerFor } from "@/lib/evidence/registry";
import { getPerson, withGoalsDb, withReadingDb, type Transaction } from "@/lib/session";
import { TIME_ZONE } from "@/lib/zone";

/**
 * Every source key `withReadingDb`'s query fans out to, kept beside this
 * file rather than derived from the day's own commitments: a distinct set of
 * keys can only be known once the goals query has already returned, and
 * waiting on that would turn the second transaction's opening into a
 * continuation of the first's — the very chain RNP-03 forbids. Both
 * transactions open, settle and query concurrently instead; the mapping step
 * below decides, once both have answered, which commitment each source's
 * rows belong to. A second source (RNP-10) costs a reader in
 * `lib/evidence/registry.ts`, a row in `goals.evidence_sources`, and one more
 * key here.
 */
const KNOWN_EVIDENCE_SOURCE_KEYS = ["reading_lookups"] as const;

type GoalRow = {
  id: string;
  name: string;
  horizon: string;
  measure_name: string | null;
  measure_unit: string | null;
};

// `source_key` and `source_unit` ride in from the join to `evidence_sources`;
// neither column exists on `commitments` itself (RNP-10 keeps the source a
// row of configuration, not a commitment column).
type CommitmentRow = {
  id: string;
  cadence_kind: Cadence["kind"];
  cadence_n: number | null;
  cadence_weekdays: number[] | null;
  satisfaction: SatisfiedBy["kind"];
  target_quantity: number | null;
  unit: string | null;
  threshold: number | null;
  retired_at: string | null;
  created_at: string;
  source_key: string | null;
  source_unit: string | null;
};

type PhaseRow = {
  id: string;
  aim: string;
  starts_on: string;
  ends_on: string | null;
};

// `commitment_unit` rides in from the join to `commitments`: a fact carries a
// bare quantity, never its own unit (`db/schema/commitments.ts`'s own
// comment — "the unit belongs here, never to the fact that repeats it").
type FactRow = {
  commitment_id: string | null;
  one_off_id: string | null;
  day: string;
  written_at: string;
  quantity: number | null;
  note: string | null;
  commitment_unit: string | null;
};

type OneOffRow = {
  id: string;
  goal_id: string | null;
  name: string;
  day: string | null;
};

// The one statement's whole shape. `goals` and `one_offs` are fetched here,
// as the contract requires, and go unused by this file: `deriveDay` takes no
// goals array and `DayView` has no place for a one-off. A later screen reads
// both from this same round trip; this file computes no state of its own.
type GoalsQueryRow = {
  goals: GoalRow[];
  commitments: CommitmentRow[];
  phases: PhaseRow[];
  facts: FactRow[];
  one_offs: OneOffRow[];
};

type EvidenceOutcome = {
  status: "read" | "unreadable";
  bySourceKey: Record<string, EvidenceDay[]>;
};

/**
 * One statement, five subqueries: everything the day's derivation needs,
 * scoped to the caller's own rows by RLS alone — no `user_id` filter is
 * written here, the same choice `lib/evidence/reading-lookups.ts` took, so
 * the policy is the reason the rows are safe, not a second copy of it.
 */
async function queryGoalsRow(tx: Transaction, day: string): Promise<GoalsQueryRow> {
  const [row] = await tx.execute<GoalsQueryRow>(sql`
    select
      (select coalesce(json_agg(to_jsonb(g)), '[]'::json)
         from "goals"."goals" g) as goals,
      (select coalesce(json_agg(to_jsonb(c) || jsonb_build_object(
                 'source_key', s.key,
                 'source_unit', s.unit
               )), '[]'::json)
         from "goals"."commitments" c
         left join "goals"."evidence_sources" s on s.id = c.source_id
         where c.retired_at is null or c.retired_at::date >= ${day}::date) as commitments,
      (select coalesce(json_agg(to_jsonb(p)), '[]'::json)
         from "goals"."phases" p
         where p.starts_on <= ${day}::date
           and (p.ends_on is null or p.ends_on >= ${day}::date)) as phases,
      (select coalesce(json_agg(to_jsonb(f) || jsonb_build_object(
                 'commitment_unit', c.unit
               )), '[]'::json)
         from "goals"."facts" f
         left join "goals"."commitments" c on c.id = f.commitment_id
         where f.day = ${day}::date) as facts,
      (select coalesce(json_agg(to_jsonb(o)), '[]'::json)
         from "goals"."one_offs" o
         where o.day = ${day}::date) as one_offs
  `);

  return row;
}

// One query per known source (today, exactly one), independent of which
// commitments actually reference it: the mapping step below is what narrows
// the result back down to the commitments that asked for it.
async function queryEvidenceBySource(
  tx: Transaction,
  personId: string,
  day: string,
): Promise<Record<string, EvidenceDay[]>> {
  const bySourceKey: Record<string, EvidenceDay[]> = {};

  for (const key of KNOWN_EVIDENCE_SOURCE_KEYS) {
    const reader = readerFor(key);
    if (!reader) continue;
    bySourceKey[key] = await reader({ personId, from: day, to: day, zone: TIME_ZONE, tx });
  }

  return bySourceKey;
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
      // `goals.commitments` has no anchor column (a gap between this schema
      // and the engine's `Cadence` shape): the commitment's own creation day
      // is the least surprising stand-in, since "every N days" then counts
      // from the day the person set it up.
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

function toCommitmentPlan(row: CommitmentRow): CommitmentPlan {
  return {
    id: row.id,
    cadence: toCadence(row),
    satisfiedBy: toSatisfiedBy(row),
    retiredAt: row.retired_at,
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

// Evidence arrives keyed by source, never by commitment (RNP-10: a source
// answers for the person, not for one commitment). This is the one place
// that turns it into the per-commitment map `deriveDay` expects, matching
// each evidence-satisfied commitment to the source it names.
function toEvidenceByCommitment(
  commitments: CommitmentRow[],
  bySourceKey: Record<string, EvidenceDay[]>,
): EvidenceByCommitment {
  const byCommitment: EvidenceByCommitment = {};

  for (const row of commitments) {
    if (row.satisfaction !== "evidence" || !row.source_key) continue;
    const days = bySourceKey[row.source_key];
    if (days) byCommitment[row.id] = days;
  }

  return byCommitment;
}

/**
 * Feeds the day screen in exactly two transactions, fanned with `Promise
 * .all` and never chained (RNP-03): `withGoalsDb`'s one statement is
 * everything the day derives from, `withReadingDb`'s is every known
 * source's rows for `[day, day]`. The evidence promise is settled here, not
 * awaited bare — a rejection degrades to `"unreadable"` and the declared
 * facts alone decide the day (RNP-04): never a blank day, never an error
 * page.
 */
export async function loadDay(
  day: string,
): Promise<{ view: DayView; evidence: "read" | "unreadable" }> {
  const person = await getPerson();
  if (!person) throw new Error("loadDay called without a verified session");

  const [row, evidenceOutcome] = await Promise.all([
    withGoalsDb((tx) => queryGoalsRow(tx, day)),
    withReadingDb((tx) => queryEvidenceBySource(tx, person.id, day)).then(
      (bySourceKey): EvidenceOutcome => ({ status: "read", bySourceKey }),
      (): EvidenceOutcome => ({ status: "unreadable", bySourceKey: {} }),
    ),
  ]);

  const commitments = row.commitments.map(toCommitmentPlan);
  const phases = row.phases.map(toPhase);
  // A one-off's fact carries no `commitment_id`; `DeclaredFact` names one
  // that always does, so a one-off's own fact plays no part in deriving a
  // commitment's slot (RP-19's list is a future screen's own reading of the
  // `one_offs` this statement already fetched).
  const facts = row.facts
    .filter((fact): fact is FactRow & { commitment_id: string } => fact.commitment_id !== null)
    .map(toDeclaredFact);
  const evidence = toEvidenceByCommitment(row.commitments, evidenceOutcome.bySourceKey);

  const view = deriveDay({ commitments, phases, facts, evidence, day });

  return { view, evidence: evidenceOutcome.status };
}
