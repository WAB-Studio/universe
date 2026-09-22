import { z } from "zod";

import { isCivilDate } from "@/lib/zone";

// A day the person named for their errand — required here. A one-off with no
// day at all is RP-21, out of this slice: the column stays nullable for that
// future list, but nothing in this schema accepts the missing day.
const civilDate = (message: string) => z.string().refine(isCivilDate, { error: message });

export const createOneOffSchema = z.object({
  name: z
    .string({ error: "day.errors.oneOffNameEmpty" })
    .trim()
    .min(1, { error: "day.errors.oneOffNameEmpty" })
    .max(120, { error: "day.errors.oneOffNameTooLong" }),
  day: civilDate("day.errors.oneOffDayInvalid"),
  // Absent, a one-off belongs to nothing (RP-20) and its week is still shown.
  goalId: z.uuid({ error: "plan.errors.goalInvalid" }).nullish(),
});

export type CreateOneOffInput = z.infer<typeof createOneOffSchema>;

export const completeOneOffSchema = z.object({
  oneOffId: z.uuid({ error: "day.errors.invalid" }),
});

export type CompleteOneOffInput = z.infer<typeof completeOneOffSchema>;
