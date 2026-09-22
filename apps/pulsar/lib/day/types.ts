// The engine's own plain shapes. Nothing here comes from a drizzle schema and
// nothing here names an app, a table or a reading-app search: RP-07 and
// RNP-10 both require a source to be configuration the engine never inspects.

// What counts and how often (RP-12). `weekdays.days` uses `Date#getUTCDay`'s
// own numbering (0 = Sunday .. 6 = Saturday), the same one `zone.ts` reads a
// civil date's weekday with, so the two never need a translation table.
export type Cadence =
  | { kind: "daily" }
  | { kind: "weekdays"; days: number[] }
  | { kind: "times_per_week"; count: number }
  | { kind: "every_n_days"; n: number; anchor: string }
  | { kind: "times_per_month"; count: number };

// What satisfies the commitment: a tap, a quantity that must reach a target,
// or evidence that must reach a threshold (RP-02, RP-03, RP-08).
export type SatisfiedBy =
  | { kind: "tap" }
  | { kind: "quantity"; target: number; unit: string }
  | { kind: "evidence"; threshold: number; unit: string };

export type CommitmentPlan = {
  id: string;
  cadence: Cadence;
  satisfiedBy: SatisfiedBy;
  // A civil date, or null while active. Retired, never deleted (RP-13): a
  // week already lived keeps asking exactly as it did before this was set.
  retiredAt: string | null;
};

// A span of weeks with its own single aim (RP-15). `endsOn` is null for a
// phase left open-ended — the last one a plan names, most often.
export type Phase = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string | null;
};

// Something the person declared, in one tap (RP-02, RP-05). `day` is the day
// it happened; `writtenAt` is the moment it was written — RP-06 keeps the two
// apart, so a fact logged late for yesterday never reads as today's.
export type DeclaredFact = {
  commitmentId: string;
  day: string;
  writtenAt: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
};

// A row another app's own reader already turned into this shape (RNP-10).
// Nothing past this point can tell which app it came from.
export type EvidenceDay = {
  day: string;
  quantity: number;
  unit: string;
  labelKey: string;
};

// One commitment's state for a day it asked on: whether it is satisfied, and
// — when it is — how (RP-09 names evidence wherever it is drawn, so a day
// evidence closed never reads as a day the person said they did). A
// commitment that did not ask that day has no slot at all.
export type DaySlot = {
  commitmentId: string;
  satisfied: boolean;
  satisfiedBy: "declared" | "evidence" | null;
  labelKey: string | null;
  quantity: number | null;
};

export type DayView = {
  day: string;
  slots: DaySlot[];
  phase: Phase | null;
};

export type WeekView = {
  start: string;
  days: DayView[];
};
