"use server";

import { revalidatePath } from "next/cache";

import { and, eq, isNull, sql } from "drizzle-orm";

import { commitments, evidenceSources, goals, phases } from "@/db/schema";
import { getPerson, withGoalsDb } from "@/lib/session";
import {
  addCommitmentSchema,
  addPhaseSchema,
  createGoalSchema,
  retireCommitmentSchema,
  type AddCommitmentInput,
  type AddPhaseInput,
  type CreateGoalInput,
  type RetireCommitmentInput,
} from "@/lib/validation/plan";

export type CreateGoalResult = { ok: true; goalId: string } | { ok: false; error: string };
export type AddPhaseResult = { ok: true; phaseId: string } | { ok: false; error: string };
export type AddCommitmentResult =
  | { ok: true; commitmentId: string }
  | { ok: false; error: string };
export type RetireCommitmentResult = { ok: true } | { ok: false; error: string };

// Carries a message key out of the transaction without collapsing every
// rejection into the same generic failure.
class NamedError extends Error {}

// Never a bare array parameter — drizzle expands a JS array inside a `sql`
// template into a parenthesised comma list, not a Postgres array literal
// (docs/TRAPS.md, "An array binding is not an array"). Built as an explicit
// `ARRAY[...]::smallint[]` instead, the way `writeCachedAnswer` builds one
// for `text[]`.
function weekdaysArraySql(days: number[]) {
  return sql`ARRAY[${sql.join(
    days.map((day) => sql`${day}`),
    sql`, `,
  )}]::smallint[]`;
}

/**
 * Opens a goal with a name and a horizon alone (§0.3, 3; RP-11). The measure
 * columns are never named in this INSERT, so they land null by the shape of
 * the statement — `goals`' INSERT grant does not even list them. Named
 * columns only (docs/TRAPS.md, "Drizzle's insert builder names every
 * column"): `.insert(goals).values()` would name every column of the table
 * and fill `measure_name`/`measure_unit` with the bare word `default`, which
 * the grant refuses just as surely as a real value.
 */
export async function createGoal(input: CreateGoalInput): Promise<CreateGoalResult> {
  const parsed = createGoalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const person = await getPerson();
  if (!person) return { ok: false, error: "plan.errors.signedOut" };

  const { name, horizon } = parsed.data;

  const goalId = await withGoalsDb(async (tx) => {
    const [inserted] = await tx.execute<{ id: string }>(sql`
      insert into ${goals} (user_id, name, horizon)
      values (${person.id}, ${name}, ${horizon})
      returning id
    `);

    return inserted.id;
  });

  revalidatePath("/");
  return { ok: true, goalId };
}

/**
 * Gives a goal a phase (RP-15). The goal is read back before the insert
 * rather than trusted by id: `phases_insert_self` only checks that the new
 * row's own `user_id` is the caller, never that `goal_id` names one of
 * theirs, so a foreign id would otherwise attach silently. The read runs
 * inside the same settled transaction, so `goals_select_self` — not a `where`
 * this function writes — is what actually hides someone else's goal.
 */
export async function addPhase(input: AddPhaseInput): Promise<AddPhaseResult> {
  const parsed = addPhaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const person = await getPerson();
  if (!person) return { ok: false, error: "plan.errors.signedOut" };

  const { goalId, aim, startsOn, endsOn } = parsed.data;

  try {
    const phaseId = await withGoalsDb(async (tx) => {
      const [goal] = await tx.select({ id: goals.id }).from(goals).where(eq(goals.id, goalId));
      if (!goal) throw new NamedError("plan.errors.goalNotFound");

      const [inserted] = await tx.execute<{ id: string }>(sql`
        insert into ${phases} (user_id, goal_id, aim, starts_on, ends_on)
        values (${person.id}, ${goalId}, ${aim}, ${startsOn}, ${endsOn})
        returning id
      `);

      return inserted.id;
    });

    revalidatePath("/");
    return { ok: true, phaseId };
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Gives a goal a commitment (RP-12). Like `addPhase`, the goal is read back
 * before the insert so `goals_select_self` — not this function — refuses a
 * foreign id. `sourceKey` is resolved to `evidence_sources.id` inside this
 * same transaction, never a second round trip a caller could race between.
 *
 * When this is the goal's first `quantity` commitment, the same transaction
 * names the goal's measure after it: `goals`' grant permits
 * `UPDATE (measure_name, measure_unit)` alone, and the `WHERE measure_name IS
 * NULL` is what leaves a later quantity commitment's measure untouched — the
 * row is simply not matched a second time (RP-14).
 */
export async function addCommitment(input: AddCommitmentInput): Promise<AddCommitmentResult> {
  const parsed = addCommitmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const person = await getPerson();
  if (!person) return { ok: false, error: "plan.errors.signedOut" };

  const data = parsed.data;

  try {
    const commitmentId = await withGoalsDb(async (tx) => {
      const [goal] = await tx
        .select({ id: goals.id })
        .from(goals)
        .where(eq(goals.id, data.goalId));
      if (!goal) throw new NamedError("plan.errors.goalNotFound");

      let sourceId: string | null = null;
      if (data.satisfaction === "evidence") {
        const [source] = await tx
          .select({ id: evidenceSources.id })
          .from(evidenceSources)
          .where(eq(evidenceSources.key, data.sourceKey));
        if (!source) throw new NamedError("plan.errors.sourceNotFound");
        sourceId = source.id;
      }

      const cadenceN = "cadenceN" in data ? data.cadenceN : null;
      const cadenceWeekdays = "cadenceWeekdays" in data ? weekdaysArraySql(data.cadenceWeekdays) : sql`null`;
      const targetQuantity = "targetQuantity" in data ? data.targetQuantity : null;
      const unit = "unit" in data ? data.unit : null;
      const threshold = "threshold" in data ? data.threshold : null;

      const [inserted] = await tx.execute<{ id: string }>(sql`
        insert into ${commitments}
          (user_id, goal_id, name, cadence_kind, cadence_n, cadence_weekdays,
           satisfaction, target_quantity, unit, source_id, threshold)
        values
          (${person.id}, ${data.goalId}, ${data.name}, ${data.cadenceKind}, ${cadenceN},
           ${cadenceWeekdays}, ${data.satisfaction}, ${targetQuantity}, ${unit},
           ${sourceId}, ${threshold})
        returning id
      `);

      if (data.satisfaction === "quantity") {
        await tx
          .update(goals)
          .set({ measureName: data.name, measureUnit: data.unit })
          .where(and(eq(goals.id, data.goalId), isNull(goals.measureName)));
      }

      return inserted.id;
    });

    revalidatePath("/");
    return { ok: true, commitmentId };
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Retires a commitment (RP-13). One UPDATE of `retired_at` alone — the grant
 * lets nothing else move, so there is no `deleteCommitment` to write in the
 * first place. Scoped by `(id, userId)` in the query itself, the way
 * `undoFact` scopes its delete: a commitment belonging to someone else
 * retires nothing and is reported exactly the way a missing one would be.
 */
export async function retireCommitment(
  input: RetireCommitmentInput,
): Promise<RetireCommitmentResult> {
  const parsed = retireCommitmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const person = await getPerson();
  if (!person) return { ok: false, error: "plan.errors.signedOut" };

  const retired = await withGoalsDb((tx) =>
    tx
      .update(commitments)
      .set({ retiredAt: sql`now()` })
      .where(
        and(eq(commitments.id, parsed.data.commitmentId), eq(commitments.userId, person.id)),
      )
      .returning({ id: commitments.id }),
  );

  if (retired.length === 0) return { ok: false, error: "plan.errors.notFound" };

  revalidatePath("/");
  return { ok: true };
}
