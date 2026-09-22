import assert from "node:assert/strict";
import test from "node:test";

import { asksOn } from "./cadence";
import type { CommitmentPlan, DeclaredFact } from "./types";

function plan(overrides: Partial<CommitmentPlan> = {}): CommitmentPlan {
  return {
    id: "c1",
    cadence: { kind: "daily" },
    satisfiedBy: { kind: "tap" },
    retiredAt: null,
    ...overrides,
  };
}

function fact(day: string, overrides: Partial<DeclaredFact> = {}): DeclaredFact {
  return {
    commitmentId: "c1",
    day,
    writtenAt: `${day}T12:00:00Z`,
    quantity: null,
    unit: null,
    note: null,
    ...overrides,
  };
}

// --- daily ---

test("daily: asks every day, with no facts at all", () => {
  const p = plan({ cadence: { kind: "daily" } });
  assert.equal(asksOn(p, "2026-03-01", []), true);
  assert.equal(asksOn(p, "2026-03-02", []), true);
});

test("daily: a retired commitment asks nothing from the day after it was retired", () => {
  // 2026-03-03 is a Tuesday.
  const p = plan({ cadence: { kind: "daily" }, retiredAt: "2026-03-03" });
  assert.equal(asksOn(p, "2026-03-02", []), true, "Monday before still asks");
  assert.equal(asksOn(p, "2026-03-04", []), false, "no day after it asks");
});

// --- weekdays ---

test("weekdays: asks only on the named weekdays (0 = Sunday .. 6 = Saturday)", () => {
  // 2026-03-02 is a Monday, 2026-03-03 a Tuesday.
  const p = plan({ cadence: { kind: "weekdays", days: [1] } });
  assert.equal(asksOn(p, "2026-03-02", []), true);
  assert.equal(asksOn(p, "2026-03-03", []), false);
});

test("weekdays: an empty day list never asks", () => {
  const p = plan({ cadence: { kind: "weekdays", days: [] } });
  assert.equal(asksOn(p, "2026-03-02", []), false);
});

// --- times_per_week ---

test("times_per_week: asks while the week's quota is not yet met", () => {
  const p = plan({ cadence: { kind: "times_per_week", count: 2 } });
  // Monday 2026-03-02 .. Sunday 2026-03-08.
  const facts = [fact("2026-03-02")];
  assert.equal(asksOn(p, "2026-03-04", facts), true, "one done, one still owed");
});

test("times_per_week: stops asking once the week's quota is met, before the day itself", () => {
  const p = plan({ cadence: { kind: "times_per_week", count: 2 } });
  const facts = [fact("2026-03-02"), fact("2026-03-03")];
  assert.equal(asksOn(p, "2026-03-05", facts), false, "quota already met earlier in the week");
});

test("times_per_week: the day that would complete the quota still asks", () => {
  const p = plan({ cadence: { kind: "times_per_week", count: 2 } });
  const facts = [fact("2026-03-02")];
  assert.equal(asksOn(p, "2026-03-03", facts), true, "still owed as of the start of the day");
});

test("times_per_week: a new week resets the quota", () => {
  const p = plan({ cadence: { kind: "times_per_week", count: 2 } });
  const facts = [fact("2026-03-02"), fact("2026-03-03")];
  assert.equal(asksOn(p, "2026-03-09", facts), true, "next Monday owes the quota again");
});

// --- every_n_days ---

test("every_n_days: asks only on the anchor and every n-th day after it", () => {
  const p = plan({ cadence: { kind: "every_n_days", n: 3, anchor: "2026-03-01" } });
  assert.equal(asksOn(p, "2026-03-01", []), true, "the anchor day itself");
  assert.equal(asksOn(p, "2026-03-04", []), true, "3 days later");
  assert.equal(asksOn(p, "2026-03-03", []), false, "2 days later");
});

test("every_n_days: never asks before the anchor", () => {
  const p = plan({ cadence: { kind: "every_n_days", n: 3, anchor: "2026-03-01" } });
  assert.equal(asksOn(p, "2026-02-28", []), false);
});

// --- times_per_month ---

test("times_per_month: asks while the month's quota is not yet met", () => {
  const p = plan({ cadence: { kind: "times_per_month", count: 1 } });
  assert.equal(asksOn(p, "2026-03-15", []), true);
});

test("times_per_month: stops asking once the month's quota is met, before the day itself", () => {
  const p = plan({ cadence: { kind: "times_per_month", count: 1 } });
  const facts = [fact("2026-03-05")];
  assert.equal(asksOn(p, "2026-03-15", facts), false);
});

test("times_per_month: a new month resets the quota", () => {
  const p = plan({ cadence: { kind: "times_per_month", count: 1 } });
  const facts = [fact("2026-03-05")];
  assert.equal(asksOn(p, "2026-04-01", facts), true);
});

// --- retirement holds across every cadence, not only "daily" ---

test("a week already lived keeps its shape: each day is judged against its own date, not today's", () => {
  const p = plan({
    cadence: { kind: "weekdays", days: [1, 2, 3, 4, 5] },
    retiredAt: "2026-03-10",
  });
  assert.equal(asksOn(p, "2026-03-09", []), true, "Monday, before retirement");
  assert.equal(asksOn(p, "2026-03-11", []), false, "Wednesday, after retirement");
});
