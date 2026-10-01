"use server";

import { revalidatePath } from "next/cache";

import { and, eq, sql } from "drizzle-orm";

import { goals, monthBudgets } from "@/db/schema";
import { getPerson, withGoalsDb } from "@/lib/session";
import {
  monthOutsideSpan,
  monthStart,
  removeMonthBudgetSchema,
  setMonthBudgetSchema,
  type RemoveMonthBudgetInput,
  type SetMonthBudgetInput,
} from "@/lib/validation/budget";
import { isClosed } from "@/lib/validation/closed";
import { civilDateInZone, todayInZone } from "@/lib/zone";

export type SetMonthBudgetResult = { ok: true } | { ok: false; error: string };
export type RemoveMonthBudgetResult = { ok: true } | { ok: false; error: string };

// Carries a message key out of the transaction without collapsing every
// rejection into the same generic failure.
class NamedError extends Error {}

function revalidateMonthScreens(goalId: string, month: string): void {
  revalidatePath("/");
  revalidatePath(`/metas/${goalId}`);
  revalidatePath(`/metas/${goalId}/meses`);
  revalidatePath(`/metas/${goalId}/meses/${month}`);
}

/**
 * Plans an amount for one goal in one month, or changes the one planned
 * (RP-28). The goal is read back first: `month_budgets_insert_self` checks
 * only the row's own `user_id`, so `goals_select_self` is what hides a
 * foreign goal. Raw SQL naming the four granted columns (docs/TRAPS.md,
 * "Drizzle's insert builder names every column"); the conflict arm moves
 * `amount` alone, the one column `UPDATE` is granted on.
 */
export async function setMonthBudget(input: SetMonthBudgetInput): Promise<SetMonthBudgetResult> {
  const parsed = setMonthBudgetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const person = await getPerson();
  if (!person) return { ok: false, error: "month.errors.signedOut" };

  const { goalId, month, amount } = parsed.data;

  try {
    await withGoalsDb(async (tx) => {
      const [goal] = await tx
        .select({
          horizon: goals.horizon,
          archivedAt: goals.archivedAt,
          measureUnit: goals.measureUnit,
          createdAt: goals.createdAt,
        })
        .from(goals)
        .where(eq(goals.id, goalId));
      if (!goal) throw new NamedError("month.errors.notFound");
      if (isClosed(goal)) throw new NamedError("month.errors.closed");
      if (goal.measureUnit === null) throw new NamedError("month.errors.noMeasure");

      if (month < todayInZone().slice(0, 7)) throw new NamedError("month.errors.monthClosed");

      const openedOn = civilDateInZone(goal.createdAt);
      if (monthOutsideSpan({ month, openedOn, horizon: goal.horizon })) {
        throw new NamedError("month.errors.outsideSpan");
      }

      await tx.execute(sql`
        insert into ${monthBudgets} (user_id, goal_id, month, amount)
        values (${person.id}, ${goalId}, ${monthStart(month)}, ${amount})
        on conflict (goal_id, month) do update set amount = excluded.amount
      `);
    });
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: error.message };
    throw error;
  }

  revalidateMonthScreens(goalId, month);
  return { ok: true };
}

/**
 * Takes a month's amount away (RP-28). A closed goal's months are refused the
 * way `setMonthBudget` refuses them: removing is a write. A month with none
 * already is the outcome asked for, so deleting nothing is not a refusal.
 * A month already over is the plan it was lived against: both actions refuse it.
 * `month_budgets_delete_self` scopes the delete to the caller's own rows.
 */
export async function removeMonthBudget(
  input: RemoveMonthBudgetInput,
): Promise<RemoveMonthBudgetResult> {
  const parsed = removeMonthBudgetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const person = await getPerson();
  if (!person) return { ok: false, error: "month.errors.signedOut" };

  const { goalId, month } = parsed.data;

  try {
    await withGoalsDb(async (tx) => {
      const [goal] = await tx
        .select({ horizon: goals.horizon, archivedAt: goals.archivedAt })
        .from(goals)
        .where(eq(goals.id, goalId));
      if (!goal) throw new NamedError("month.errors.notFound");
      if (isClosed(goal)) throw new NamedError("month.errors.closed");
      if (month < todayInZone().slice(0, 7)) throw new NamedError("month.errors.monthClosed");

      await tx
        .delete(monthBudgets)
        .where(and(eq(monthBudgets.goalId, goalId), eq(monthBudgets.month, monthStart(month))));
    });
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: error.message };
    throw error;
  }

  revalidateMonthScreens(goalId, month);
  return { ok: true };
}
