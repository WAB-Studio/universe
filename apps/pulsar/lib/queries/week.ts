import "server-only";

import { sql } from "drizzle-orm";

import { deriveWeek, type EvidenceByCommitment } from "@/lib/day/derive";
import type {
  Cadence,
  CommitmentPlan,
  DeclaredFact,
  EvidenceDay,
  Phase,
  SatisfiedBy,
  WeekView,
} from "@/lib/day/types";
import { readerFor } from "@/lib/evidence/registry";
import { getPerson, withGoalsDb, withReadingDb, type Transaction } from "@/lib/session";
import { TIME_ZONE, weekOf } from "@/lib/zone";

// The same fixed list `lib/queries/day.ts` keeps, for the same reason: a set
// derived from the week's own commitments would only be known once the
// `goals` query resolved, turning this `Promise.all` into the chain RNP-03
// forbids. A second source costs a reader, a catalogue row and one more key
// here — never a migration (RNP-10).
const KNOWN_EVIDENCE_SOURCE_KEYS = ["reading_lookups"] as const;

// `source_key` / `source_unit` ride in from the join to `evidence_sources`;
// neither column exists on `commitments` itself.
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
// bare quantity, never its own unit.
type FactRow = {
  commitment_id: string | null;
  day: string;
  written_at: string;
  quantity: number | null;
  note: string | null;
  commitment_unit: string | null;
};

type WeekQueryRow = {
  commitments: CommitmentRow[];
  phases: PhaseRow[];
  facts: FactRow[];
};

type EvidenceOutcome = {
  status: "read" | "unreadable";
  bySourceKey: Record<string, EvidenceDay[]>;
};

/**
 * One statement, three subqueries: every commitment not retired before the
 * week's own first day (a commitment retired mid-week must still explain the
 * days it lived through), every phase touching the week, and every fact of
 * the week's seven civil days. No `user_id` filter: RLS alone decides, the
 * same choice `lib/queries/day.ts` and `lib/evidence/reading-lookups.ts` took.
 */
async function queryGoalsRow(
  tx: Transaction,
  weekStart: string,
  weekEnd: string,
): Promise<WeekQueryRow> {
  const [row] = await tx.execute<WeekQueryRow>(sql`
    select
      (select coalesce(json_agg(to_jsonb(c) || jsonb_build_object(
                 'source_key', s.key,
                 'source_unit', s.unit
               )), '[]'::json)
         from "goals"."commitments" c
         left join "goals"."evidence_sources" s on s.id = c.source_id
         where c.retired_at is null or c.retired_at::date >= ${weekStart}::date) as commitments,
      (select coalesce(json_agg(to_jsonb(p)), '[]'::json)
         from "goals"."phases" p
         where p.starts_on <= ${weekEnd}::date
           and (p.ends_on is null or p.ends_on >= ${weekStart}::date)) as phases,
      (select coalesce(json_agg(to_jsonb(f) || jsonb_build_object(
                 'commitment_unit', c.unit
               )), '[]'::json)
         from "goals"."facts" f
         left join "goals"."commitments" c on c.id = f.commitment_id
         where f.day between ${weekStart}::date and ${weekEnd}::date) as facts
  `);

  return row;
}

// One query per known source (today, exactly one), independent of which
// commitments actually reference it — the mapping step below narrows the
// result back down to the commitments that asked for it.
async function queryEvidenceBySource(
  tx: Transaction,
  personId: string,
  weekStart: string,
  weekEnd: string,
): Promise<Record<string, EvidenceDay[]>> {
  const bySourceKey: Record<string, EvidenceDay[]> = {};

  for (const key of KNOWN_EVIDENCE_SOURCE_KEYS) {
    const reader = readerFor(key);
    if (!reader) continue;
    bySourceKey[key] = await reader({
      personId,
      from: weekStart,
      to: weekEnd,
      zone: TIME_ZONE,
      tx,
    });
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
      // `goals.commitments` has no anchor column: the commitment's own
      // creation day stands in, the same choice `lib/queries/day.ts` took.
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

// Evidence arrives keyed by source, never by commitment: this turns it into
// the per-commitment map `deriveWeek` expects.
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
 * Feeds the week screen in exactly two transactions, fanned with `Promise
 * .all` and never chained (RNP-03) — the same abanico as `lib/queries/
 * day.ts`'s `loadDay`, over the seven civil days `anyDayInIt` sits in rather
 * than one. The evidence promise is settled here, not awaited bare: a
 * rejection degrades to `"unreadable"` and `deriveWeek` derives all seven
 * days from the declared facts alone (RNP-04).
 */
export async function loadWeek(
  anyDayInIt: string,
): Promise<{ view: WeekView; evidence: "read" | "unreadable" }> {
  const person = await getPerson();
  if (!person) throw new Error("loadWeek called without a verified session");

  const week = weekOf(anyDayInIt);
  const weekStart = week[0];
  const weekEnd = week[6];

  const [row, evidenceOutcome] = await Promise.all([
    withGoalsDb((tx) => queryGoalsRow(tx, weekStart, weekEnd)),
    withReadingDb((tx) => queryEvidenceBySource(tx, person.id, weekStart, weekEnd)).then(
      (bySourceKey): EvidenceOutcome => ({ status: "read", bySourceKey }),
      (): EvidenceOutcome => ({ status: "unreadable", bySourceKey: {} }),
    ),
  ]);

  const commitments = row.commitments.map(toCommitmentPlan);
  const phases = row.phases.map(toPhase);
  // A one-off's fact carries no `commitment_id`; it plays no part in a
  // commitment's own slot, the same filter `lib/queries/day.ts` applies.
  const facts = row.facts
    .filter((fact): fact is FactRow & { commitment_id: string } => fact.commitment_id !== null)
    .map(toDeclaredFact);
  const evidence = toEvidenceByCommitment(row.commitments, evidenceOutcome.bySourceKey);

  const view = deriveWeek({ commitments, phases, facts, evidence, day: anyDayInIt });

  return { view, evidence: evidenceOutcome.status };
}
