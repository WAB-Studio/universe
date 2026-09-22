import { z } from "zod";

import { isCivilDate } from "@/lib/zone";

// A day the person named, never the server's own clock (unlike a fact's
// `writtenAt`): a horizon or a phase boundary is chosen ahead of time.
const civilDate = (message: string) => z.string().refine(isCivilDate, { error: message });

export const createGoalSchema = z.object({
  // Two fields, no measure (§0.3, 3): the measure columns land null and are
  // named later, by the first commitment that measures something.
  name: z
    .string({ error: "plan.errors.nameEmpty" })
    .trim()
    .min(1, { error: "plan.errors.nameEmpty" })
    .max(120, { error: "plan.errors.nameTooLong" }),
  horizon: civilDate("plan.errors.horizonInvalid"),
});

export type CreateGoalInput = z.infer<typeof createGoalSchema>;

export const addPhaseSchema = z
  .object({
    goalId: z.uuid({ error: "plan.errors.goalInvalid" }),
    aim: z
      .string({ error: "plan.errors.aimEmpty" })
      .trim()
      .min(1, { error: "plan.errors.aimEmpty" })
      .max(200, { error: "plan.errors.aimTooLong" }),
    startsOn: civilDate("plan.errors.startsOnInvalid"),
    endsOn: civilDate("plan.errors.endsOnInvalid"),
  })
  // Mirrors `phases_ends_on_after_starts_on`: a backwards phase is refused
  // here, not by the database's own CHECK.
  .refine((data) => data.endsOn >= data.startsOn, {
    error: "plan.errors.phaseBackwards",
    path: ["endsOn"],
  });

export type AddPhaseInput = z.infer<typeof addPhaseSchema>;

// RP-12's five cadences, keyed on `cadenceKind` so an impossible column never
// reaches the database: `weekdays` asks for the days it names and nothing
// else, the three counted kinds ask for their count and nothing else, and
// `daily` asks for nothing at all. The ISO range and non-empty rules mirror
// `commitments_weekdays_iso_range` and `commitments_weekdays_for_weekdays`.
const cadenceSchema = z.discriminatedUnion("cadenceKind", [
  z.object({ cadenceKind: z.literal("daily") }),
  z.object({
    cadenceKind: z.literal("weekdays"),
    // ISO 8601: 1 = Monday, 7 = Sunday — the app's one numbering
    // (`lib/day/cadence.ts`'s `weekdayOf`), never `Date#getUTCDay`'s.
    cadenceWeekdays: z
      .array(
        z
          .number({ error: "plan.errors.weekdayInvalid" })
          .int({ error: "plan.errors.weekdayInvalid" })
          .min(1, { error: "plan.errors.weekdayInvalid" })
          .max(7, { error: "plan.errors.weekdayInvalid" }),
      )
      .min(1, { error: "plan.errors.weekdaysEmpty" }),
  }),
  z.object({
    cadenceKind: z.literal("times_per_week"),
    cadenceN: z
      .number({ error: "plan.errors.cadenceNInvalid" })
      .int({ error: "plan.errors.cadenceNInvalid" })
      .positive({ error: "plan.errors.cadenceNInvalid" }),
  }),
  z.object({
    cadenceKind: z.literal("every_n_days"),
    cadenceN: z
      .number({ error: "plan.errors.cadenceNInvalid" })
      .int({ error: "plan.errors.cadenceNInvalid" })
      .positive({ error: "plan.errors.cadenceNInvalid" }),
  }),
  z.object({
    cadenceKind: z.literal("times_per_month"),
    cadenceN: z
      .number({ error: "plan.errors.cadenceNInvalid" })
      .int({ error: "plan.errors.cadenceNInvalid" })
      .positive({ error: "plan.errors.cadenceNInvalid" }),
  }),
]);

// RP-02/RP-03/RP-07's three ways a day is satisfied, keyed on `satisfaction`
// so a `quantity` with no unit or an `evidence` with no source never reaches
// the database — mirrors `commitments_quantity_for_quantity` and
// `commitments_source_for_evidence`. `sourceKey` names a row of
// `goals.evidence_sources`; resolving it to an id is the action's job, run
// inside the same transaction as the insert (RNP-10).
const satisfactionSchema = z.discriminatedUnion("satisfaction", [
  z.object({ satisfaction: z.literal("tap") }),
  z.object({
    satisfaction: z.literal("quantity"),
    targetQuantity: z
      .number({ error: "plan.errors.targetQuantityInvalid" })
      .int({ error: "plan.errors.targetQuantityInvalid" })
      .positive({ error: "plan.errors.targetQuantityInvalid" }),
    // The person's own word for what is counted — stored as they wrote it,
    // never resolved against a catalogue (AGENTS.md «## Code»).
    unit: z
      .string({ error: "plan.errors.unitEmpty" })
      .trim()
      .min(1, { error: "plan.errors.unitEmpty" })
      .max(40, { error: "plan.errors.unitTooLong" }),
  }),
  z.object({
    satisfaction: z.literal("evidence"),
    sourceKey: z
      .string({ error: "plan.errors.sourceKeyEmpty" })
      .trim()
      .min(1, { error: "plan.errors.sourceKeyEmpty" }),
    threshold: z
      .number({ error: "plan.errors.thresholdInvalid" })
      .int({ error: "plan.errors.thresholdInvalid" })
      .min(1, { error: "plan.errors.thresholdInvalid" }),
  }),
]);

export const addCommitmentSchema = z.intersection(
  z.intersection(
    z.object({
      goalId: z.uuid({ error: "plan.errors.goalInvalid" }),
      name: z
        .string({ error: "plan.errors.nameEmpty" })
        .trim()
        .min(1, { error: "plan.errors.nameEmpty" })
        .max(120, { error: "plan.errors.nameTooLong" }),
    }),
    cadenceSchema,
  ),
  satisfactionSchema,
);

export type AddCommitmentInput = z.infer<typeof addCommitmentSchema>;

export const retireCommitmentSchema = z.object({
  commitmentId: z.uuid({ error: "plan.errors.commitmentInvalid" }),
});

export type RetireCommitmentInput = z.infer<typeof retireCommitmentSchema>;
