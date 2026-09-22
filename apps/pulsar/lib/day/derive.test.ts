import assert from "node:assert/strict";
import test from "node:test";

import { civilDateInZone } from "@/lib/zone";
import { deriveDay, deriveWeek, measureOf, phaseOn } from "./derive";
import type {
  CommitmentPlan,
  DeclaredFact,
  EvidenceDay,
  Phase,
} from "./types";

function tapPlan(id: string, overrides: Partial<CommitmentPlan> = {}): CommitmentPlan {
  return {
    id,
    cadence: { kind: "daily" },
    satisfiedBy: { kind: "tap" },
    retiredAt: null,
    ...overrides,
  };
}

function fact(commitmentId: string, day: string, overrides: Partial<DeclaredFact> = {}): DeclaredFact {
  return {
    commitmentId,
    day,
    writtenAt: `${day}T12:00:00Z`,
    quantity: null,
    unit: null,
    note: null,
    ...overrides,
  };
}

// --- deriveDay: satisfaction by each of the three mechanisms ---

test("deriveDay: a tap commitment with no fact is asked and unsatisfied", () => {
  const view = deriveDay({
    commitments: [tapPlan("anki")],
    phases: [],
    facts: [],
    evidence: {},
    day: "2026-03-01",
  });
  assert.equal(view.slots.length, 1);
  assert.equal(view.slots[0].satisfied, false);
  assert.equal(view.slots[0].satisfiedBy, null);
});

test("deriveDay: a tap commitment is satisfied by a declared fact on the same day", () => {
  const view = deriveDay({
    commitments: [tapPlan("anki")],
    phases: [],
    facts: [fact("anki", "2026-03-01")],
    evidence: {},
    day: "2026-03-01",
  });
  assert.equal(view.slots[0].satisfied, true);
  assert.equal(view.slots[0].satisfiedBy, "declared");
});

test("deriveDay: a declared fact on another day does not satisfy today's slot", () => {
  const view = deriveDay({
    commitments: [tapPlan("anki")],
    phases: [],
    facts: [fact("anki", "2026-02-28")],
    evidence: {},
    day: "2026-03-01",
  });
  assert.equal(view.slots[0].satisfied, false);
});

test("deriveDay: a quantity commitment is unsatisfied below target and satisfied once quantities reach it", () => {
  const plan = tapPlan("monologue", { satisfiedBy: { kind: "quantity", target: 10, unit: "min" } });
  const partial = deriveDay({
    commitments: [plan],
    phases: [],
    facts: [fact("monologue", "2026-03-01", { quantity: 4, unit: "min" })],
    evidence: {},
    day: "2026-03-01",
  });
  assert.equal(partial.slots[0].satisfied, false);
  assert.equal(partial.slots[0].quantity, 4);

  const complete = deriveDay({
    commitments: [plan],
    phases: [],
    facts: [
      fact("monologue", "2026-03-01", { quantity: 4, unit: "min" }),
      fact("monologue", "2026-03-01", { quantity: 6, unit: "min" }),
    ],
    evidence: {},
    day: "2026-03-01",
  });
  assert.equal(complete.slots[0].satisfied, true);
  assert.equal(complete.slots[0].satisfiedBy, "declared");
  assert.equal(complete.slots[0].quantity, 10);
});

test("deriveDay: an evidence commitment is satisfied at or above its threshold, and names its source", () => {
  const plan = tapPlan("reading", { satisfiedBy: { kind: "evidence", threshold: 5, unit: "min" } });
  const below: Record<string, EvidenceDay[]> = {
    reading: [{ day: "2026-03-01", quantity: 3, unit: "min", labelKey: "sources.dictionary" }],
  };
  const short = deriveDay({ commitments: [plan], phases: [], facts: [], evidence: below, day: "2026-03-01" });
  assert.equal(short.slots[0].satisfied, false);
  assert.equal(short.slots[0].labelKey, null);

  const atThreshold: Record<string, EvidenceDay[]> = {
    reading: [{ day: "2026-03-01", quantity: 5, unit: "min", labelKey: "sources.dictionary" }],
  };
  const enough = deriveDay({ commitments: [plan], phases: [], facts: [], evidence: atThreshold, day: "2026-03-01" });
  assert.equal(enough.slots[0].satisfied, true);
  assert.equal(enough.slots[0].satisfiedBy, "evidence");
  assert.equal(enough.slots[0].labelKey, "sources.dictionary");
});

test("deriveDay: evidence on another day does not satisfy today's slot", () => {
  const plan = tapPlan("reading", { satisfiedBy: { kind: "evidence", threshold: 1, unit: "min" } });
  const evidence: Record<string, EvidenceDay[]> = {
    reading: [{ day: "2026-02-28", quantity: 30, unit: "min", labelKey: "sources.dictionary" }],
  };
  const view = deriveDay({ commitments: [plan], phases: [], facts: [], evidence, day: "2026-03-01" });
  assert.equal(view.slots[0].satisfied, false);
});

test("deriveDay: a commitment that does not ask today has no slot at all", () => {
  const plan = tapPlan("monday-only", { cadence: { kind: "weekdays", days: [1] } });
  // 2026-03-03 is a Tuesday.
  const view = deriveDay({ commitments: [plan], phases: [], facts: [], evidence: {}, day: "2026-03-03" });
  assert.deepEqual(view.slots, []);
});

// --- phaseOn ---

function phase(id: string, startsOn: string, endsOn: string | null): Phase {
  return { id, name: id, startsOn, endsOn };
}

test("phaseOn: the phase whose span holds the day", () => {
  const phases = [phase("unlock", "2026-01-01", "2026-01-28"), phase("precision", "2026-01-29", null)];
  assert.equal(phaseOn(phases, "2026-01-15")?.id, "unlock");
  assert.equal(phaseOn(phases, "2026-02-01")?.id, "precision");
});

test("phaseOn: null before any phase starts", () => {
  const phases = [phase("unlock", "2026-01-01", "2026-01-28")];
  assert.equal(phaseOn(phases, "2025-12-31"), null);
});

// --- measureOf ---

test("measureOf: sums only the quantities carrying the measure's own unit", () => {
  const facts = [
    fact("monologue", "2026-03-01", { quantity: 4, unit: "min" }),
    fact("monologue", "2026-03-02", { quantity: 6, unit: "min" }),
    fact("anki", "2026-03-02", { quantity: 12, unit: "cards" }),
    fact("tap", "2026-03-02"),
  ];
  assert.equal(measureOf("min", facts), 10);
  assert.equal(measureOf("cards", facts), 12);
});

test("measureOf: no matching facts sums to zero, not an error", () => {
  assert.equal(measureOf("min", []), 0);
});

// --- deriveWeek ---

test("deriveWeek: seven days starting on the Monday, each derived on its own", () => {
  const plan = tapPlan("anki");
  const week = deriveWeek({
    commitments: [plan],
    phases: [],
    facts: [fact("anki", "2026-03-03")],
    evidence: {},
    day: "2026-03-04",
  });
  assert.equal(week.start, "2026-03-02");
  assert.equal(week.days.length, 7);
  assert.equal(week.days.map((d) => d.day).join(","), [
    "2026-03-02",
    "2026-03-03",
    "2026-03-04",
    "2026-03-05",
    "2026-03-06",
    "2026-03-07",
    "2026-03-08",
  ].join(","));
  assert.equal(week.days[1].slots[0].satisfied, true, "Tuesday has the fact");
  assert.equal(week.days[2].slots[0].satisfied, false, "Wednesday does not");
});

// --- RNP-06 / Done #1: the zone boundary, not the server's ---

test("a fact written at 23:40 in the person's zone lands on that civil day, not the next one in UTC", () => {
  // 23:40 on 2026-03-01 in the person's zone (UTC-5) is 2026-03-02T04:40:00Z.
  const day = civilDateInZone(new Date("2026-03-02T04:40:00Z"));
  assert.equal(day, "2026-03-01");

  const plan = tapPlan("monologue");
  const facts = [fact("monologue", day)];

  const thatDay = deriveDay({ commitments: [plan], phases: [], facts, evidence: {}, day: "2026-03-01" });
  assert.equal(thatDay.slots[0].satisfied, true);

  const nextDay = deriveDay({ commitments: [plan], phases: [], facts, evidence: {}, day: "2026-03-02" });
  assert.equal(nextDay.slots[0].satisfied, false);
});
