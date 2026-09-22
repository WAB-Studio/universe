import type { ReactNode } from "react";

import styles from "./section-label.module.css";

// docs/pulsar/DESIGN.md "Type": the label that names a goal or a group, never
// a state. Its own element rather than a `Text` variant, because it is the one
// role in the scale that also sets case and tracking.
export function SectionLabel({ children }: { children?: ReactNode }) {
  return <span className={styles.label}>{children}</span>;
}
