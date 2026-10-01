import type { DeclaredFact } from "@/lib/day/types";
import { dayBefore } from "@/lib/day/weeks";
import { monthOf, nextMonth } from "./months";

export type Task = {
  id: string;
  parentId: string | null;
  name: string;
  plannedMonth: string | null;
  day: string | null;
  estimate: number | null;
  // The day of the one-off's own fact; null while undone.
  doneOn: string | null;
  // The one-off's own fact, for `undoFact`; absent where a caller never reads it.
  factId?: string | null;
};

export type MonthItem = {
  task: Task;
  children: Task[];
  carriedFrom: string | null;
  owes: number;
  // False when neither the task nor any child ever carried an estimate.
  hasAmount: boolean;
  done: boolean;
};

// A sub-task passes its parent; a top-level task passes nothing.
export function monthOfTask(task: Task, parent: Task | null = null): string | null {
  if (parent !== null) return monthOfTask(parent);
  return task.plannedMonth ?? (task.day ? monthOf(task.day) : null);
}

// A parent is done on the last of its children's days, once all are done.
function doneDay(task: Task, children: Task[]): string | null {
  if (children.length === 0) return task.doneOn;
  let last: string | null = null;
  for (const child of children) {
    if (child.doneOn === null) return null;
    if (last === null || child.doneOn > last) last = child.doneOn;
  }
  return last;
}

// A parent has an estimate only through its children, never its own.
function hasEstimate(task: Task, children: Task[]): boolean {
  return children.length === 0
    ? task.estimate !== null
    : children.some((child) => child.estimate !== null);
}

// What the task still owes on `before`, exclusive: a day done on `before`
// itself is not yet behind it.
export function owedAt(task: Task, children: Task[], before: string): number {
  if (children.length > 0) {
    return children.reduce((sum, child) => sum + owedAt(child, [], before), 0);
  }
  const open = task.doneOn === null || task.doneOn >= before;
  return open ? (task.estimate ?? 0) : 0;
}

function childrenOf(tasks: Task[], task: Task): Task[] {
  return tasks.filter((other) => other.parentId === task.id);
}

function isDoneBy(task: Task, children: Task[], day: string): boolean {
  const on = doneDay(task, children);
  return on !== null && on <= day;
}

function compareMonths(a: string | null, b: string | null): number {
  return (a ?? "") < (b ?? "") ? -1 : (a ?? "") > (b ?? "") ? 1 : 0;
}

function carriedIn(tasks: Task[], month: string): MonthItem[] {
  const items: MonthItem[] = [];
  for (const task of tasks) {
    if (task.parentId !== null) continue;
    const own = monthOfTask(task);
    if (own === null || own >= month) continue;
    const children = childrenOf(tasks, task);
    const owes = owedAt(task, children, month);
    const doneBefore = doneDay(task, children);
    const undoneUnestimated =
      !hasEstimate(task, children) && (doneBefore === null || doneBefore >= month);
    if (owes > 0 || undoneUnestimated) {
      items.push({
        task,
        children,
        carriedFrom: own,
        owes,
        hasAmount: hasEstimate(task, children),
        done: false,
      });
    }
  }
  // Stable sort keeps creation order inside a month.
  return items.sort((a, b) => compareMonths(a.carriedFrom, b.carriedFrom));
}

// Carried tasks first, then the month's own (RP-30). `done` reads at the
// earlier of `today` and the month's last day.
export function monthList(tasks: Task[], month: string, today: string): MonthItem[] {
  const lastDay = dayBefore(nextMonth(month));
  const readAt = today < lastDay ? today : lastDay;
  // A month after today's has nothing left undone yet (RP-31).
  const carried = month <= monthOf(today) ? carriedIn(tasks, month) : [];
  const own: MonthItem[] = [];
  for (const task of tasks) {
    if (task.parentId !== null || monthOfTask(task) !== month) continue;
    const children = childrenOf(tasks, task);
    own.push({
      task,
      children,
      carriedFrom: null,
      owes: owedAt(task, children, month),
      hasAmount: hasEstimate(task, children),
      done: false,
    });
  }
  return [...carried, ...own].map((item) => ({
    ...item,
    done: isDoneBy(item.task, item.children, readAt),
  }));
}

// What a finished month planned and what it left undone (RP-32). Integers
// only: the screen floors `carried * 100 / planned`.
export function carryShare(
  tasks: Task[],
  month: string,
): { carried: number; planned: number } | null {
  const after = nextMonth(month);
  let planned = 0;
  let carried = 0;
  for (const item of carriedIn(tasks, month)) {
    planned += item.owes;
    carried += owedAt(item.task, item.children, after);
  }
  for (const task of tasks) {
    if (task.parentId !== null || monthOfTask(task) !== month) continue;
    const children = childrenOf(tasks, task);
    planned += owedAt(task, children, "0000-01-01");
    carried += owedAt(task, children, after);
  }
  return planned === 0 ? null : { carried, planned };
}

// A done leaf's estimate as the quantity it declared (RP-36). A parent adds
// nothing: its leaves already did.
export function estimateFacts(tasks: Task[], unit: string | null): DeclaredFact[] {
  if (unit === null) return [];
  const parents = new Set(tasks.map((task) => task.parentId));
  const facts: DeclaredFact[] = [];
  for (const task of tasks) {
    if (parents.has(task.id) || task.estimate === null || task.doneOn === null) continue;
    facts.push({
      commitmentId: task.id,
      day: task.doneOn,
      writtenAt: task.doneOn,
      quantity: task.estimate,
      unit,
      note: null,
    });
  }
  return facts;
}
