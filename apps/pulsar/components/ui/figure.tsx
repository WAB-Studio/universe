import type { ReactNode } from "react";

import styles from "./figure.module.css";

// docs/pulsar/DESIGN.md: hours, counts, minutes, dates and quantities are the
// log's substance, so they are set in mono and their unit sits beside them in
// quiet. `measure` is the 26px figure; `meta` the 12px one inside a row.
export function Figure({
  value,
  unit,
  variant = "measure",
}: {
  value: ReactNode;
  unit?: string;
  variant?: "measure" | "meta";
}) {
  const size = variant === "meta" ? styles.meta : styles.measure;
  return (
    <span className={`${styles.figure} ${size}`}>
      {value}
      {unit ? <span className={styles.unit}>{unit}</span> : null}
    </span>
  );
}
