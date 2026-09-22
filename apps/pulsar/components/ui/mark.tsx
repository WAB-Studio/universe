import { Check } from "lucide-react";

import styles from "./mark.module.css";

// docs/pulsar/DESIGN.md "The marks": one shape, three states. `evidence` is a
// day another app wrote, and it never reads as one the person declared (RP-09).
export type MarkState = "declared" | "evidence" | "empty";

// `declared` is the only state with no ring: it is the accent filled.
const states: Record<MarkState, string> = {
  declared: styles.declared,
  evidence: `${styles.evidence} ${styles.ring}`,
  empty: `${styles.empty} ${styles.ring}`,
};

export function Mark({
  state,
  dashed,
  label,
}: {
  state: MarkState;
  // The one dashed stroke in the design: the row nothing has written yet
  // (docs/pulsar/DESIGN.md "Decisions taken here").
  dashed?: boolean;
  // Names the mark when it stands on its own, in a grid of days. Inside a row
  // the row's own text already says it, so the mark stays out of the tree.
  label?: string;
}) {
  const className = [styles.mark, states[state], dashed ? styles.dashed : undefined]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {state === "empty" ? null : <Check className={styles.check} strokeWidth={3} />}
    </span>
  );
}
