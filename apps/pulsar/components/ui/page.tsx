import type { ReactNode } from "react";

import styles from "./page.module.css";

// The ground every screen stands on: one column, the phone's own gutter, and
// the room a home indicator takes under the last row. No screen sets a width.
export function Page({ children }: { children?: ReactNode }) {
  return <main className={styles.page}>{children}</main>;
}
