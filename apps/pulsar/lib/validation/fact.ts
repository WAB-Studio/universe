import { z } from "zod";

// Exactly one subject, mirroring the database's own `facts_one_subject`
// check: a fact explains a commitment or a one-off, never both and never
// neither (§2 «Invariants»).
function requireOneSubject(
  data: { commitmentId?: string | null; oneOffId?: string | null },
  ctx: z.RefinementCtx,
) {
  if ((data.commitmentId != null) === (data.oneOffId != null)) {
    ctx.addIssue({
      code: "custom",
      message: "day.errors.subjectInvalid",
      path: ["commitmentId"],
    });
  }
}

export const declareFactSchema = z
  .object({
    commitmentId: z.uuid({ error: "day.errors.subjectInvalid" }).nullish(),
    oneOffId: z.uuid({ error: "day.errors.subjectInvalid" }).nullish(),
    // The commitment's own unit, never typed twice (RP-03). Whether this is
    // required at all depends on the commitment's `satisfaction`, which the
    // shape below cannot see — `requireQuantityFor` runs that check on the
    // same schema, once the action has read the commitment it names.
    quantity: z
      .number({ error: "day.errors.quantityInvalid" })
      .int({ error: "day.errors.quantityInvalid" })
      .positive({ error: "day.errors.quantityInvalid" })
      .nullish(),
    // The two mistakes from today's monologue (RP-04): offered, never required.
    note: z
      .string()
      .trim()
      .min(1, { error: "day.errors.noteEmpty" })
      .max(280, { error: "day.errors.noteTooLong" })
      .nullish(),
  })
  .superRefine(requireOneSubject);

export type DeclareFactInput = z.infer<typeof declareFactSchema>;

/**
 * A commitment satisfied by `quantity` has nothing else that satisfies it
 * (RP-03): the number is the whole gesture. Read the commitment's own
 * `satisfaction` first — never guess it from the payload — then run this
 * refinement on the very schema the form used, so a call the form could never
 * produce is refused before it reaches the database's columns, which allow a
 * null quantity on every kind of fact.
 */
export function requireQuantityFor(satisfaction: "tap" | "quantity" | "evidence") {
  return function refine(data: { quantity?: number | null }, ctx: z.RefinementCtx) {
    if (satisfaction === "quantity" && data.quantity == null) {
      ctx.addIssue({
        code: "custom",
        message: "day.errors.quantityRequired",
        path: ["quantity"],
      });
    }
  };
}

export const undoFactSchema = z.object({
  factId: z.uuid({ error: "day.errors.invalid" }),
});

export type UndoFactInput = z.infer<typeof undoFactSchema>;
