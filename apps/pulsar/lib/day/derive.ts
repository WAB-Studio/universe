import { weekOf } from "@/lib/zone";
import { asksOn } from "./cadence";
import type {
  CommitmentPlan,
  DaySlot,
  DayView,
  DeclaredFact,
  EvidenceDay,
  Phase,
  WeekView,
} from "./types";

// Evidence a caller already fanned out per commitment (RNP-10): the engine
// never learns which source filled this map, only what it says for a day.
export type EvidenceByCommitment = Record<string, EvidenceDay[]>;

type DeriveDayInput = {
  commitments: CommitmentPlan[];
  phases: Phase[];
  facts: DeclaredFact[];
  evidence: EvidenceByCommitment;
  day: string;
};

// The phase whose span holds `day`, or null when no phase covers it — before
// the first one starts, or in a gap between two that do not touch.
export function phaseOn(phases: Phase[], day: string): Phase | null {
  return (
    phases.find(
      (phase) =>
        day >= phase.startsOn && (phase.endsOn === null || day <= phase.endsOn),
    ) ?? null
  );
}

// The sum of every declared fact's quantity that carries the measure's own
// unit. A goal names one measure (RP-14); this is that measure read back,
// never a column that could drift from the facts it should equal.
export function measureOf(unit: string, facts: DeclaredFact[]): number {
  return facts.reduce(
    (total, fact) =>
      fact.unit === unit && fact.quantity !== null ? total + fact.quantity : total,
    0,
  );
}

function declaredOn(
  facts: DeclaredFact[],
  commitmentId: string,
  day: string,
): DeclaredFact[] {
  return facts.filter((fact) => fact.commitmentId === commitmentId && fact.day === day);
}

function evidenceOn(
  evidence: EvidenceByCommitment,
  commitmentId: string,
  day: string,
): EvidenceDay[] {
  return (evidence[commitmentId] ?? []).filter((row) => row.day === day);
}

// One commitment's slot for `day`: satisfied by a declared fact (a tap), by
// declared quantities that reach the commitment's target, or by evidence at
// or above its threshold — the one mechanism `satisfiedBy` names.
function deriveSlot(
  plan: CommitmentPlan,
  facts: DeclaredFact[],
  evidence: EvidenceByCommitment,
  day: string,
): DaySlot {
  const declared = declaredOn(facts, plan.id, day);

  switch (plan.satisfiedBy.kind) {
    case "tap":
      return {
        commitmentId: plan.id,
        satisfied: declared.length > 0,
        satisfiedBy: declared.length > 0 ? "declared" : null,
        labelKey: null,
        quantity: null,
      };

    case "quantity": {
      const quantity = declared.reduce((total, fact) => total + (fact.quantity ?? 0), 0);
      const satisfied = quantity >= plan.satisfiedBy.target;
      return {
        commitmentId: plan.id,
        satisfied,
        satisfiedBy: satisfied ? "declared" : null,
        labelKey: null,
        quantity,
      };
    }

    case "evidence": {
      const rows = evidenceOn(evidence, plan.id, day);
      const quantity = rows.reduce((total, row) => total + row.quantity, 0);
      const satisfied = quantity >= plan.satisfiedBy.threshold;
      return {
        commitmentId: plan.id,
        satisfied,
        satisfiedBy: satisfied ? "evidence" : null,
        labelKey: satisfied ? (rows[0]?.labelKey ?? null) : null,
        quantity,
      };
    }
  }
}

// What `day` asks for, what it got and what it is still missing: one slot
// per commitment that asks that day, and the phase in effect, if any.
export function deriveDay({
  commitments,
  phases,
  facts,
  evidence,
  day,
}: DeriveDayInput): DayView {
  const slots = commitments
    .filter((plan) => asksOn(plan, day, facts))
    .map((plan) => deriveSlot(plan, facts, evidence, day));

  return { day, slots, phase: phaseOn(phases, day) };
}

type DeriveWeekInput = {
  commitments: CommitmentPlan[];
  phases: Phase[];
  facts: DeclaredFact[];
  evidence: EvidenceByCommitment;
  day: string;
};

// The seven `DayView`s of the Monday-to-Sunday week `day` sits in. A week
// already lived keeps its shape (RP-13): each day is derived on its own,
// against the commitments as they stood that day, never against today's.
export function deriveWeek({
  commitments,
  phases,
  facts,
  evidence,
  day,
}: DeriveWeekInput): WeekView {
  const days = weekOf(day);
  return {
    start: days[0],
    days: days.map((weekDay) =>
      deriveDay({ commitments, phases, facts, evidence, day: weekDay }),
    ),
  };
}
