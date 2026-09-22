"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { Text } from "./text";
import styles from "./row.module.css";

// docs/pulsar/DESIGN.md: a row is a real `<button>`, never a div, at least 56px
// tall, ruled from the next by a hairline. Never a card, never a border box.
// Writing a fact costs one tap, so the whole row is the target (RNP-02).
type RowProps = Omit<ComponentPropsWithoutRef<"button">, "children"> & {
  // The mark at the head of the row, or nothing where a row carries no state.
  leading?: ReactNode;
  name: ReactNode;
  // The line under the name: mono, muted, a date or a count.
  meta?: ReactNode;
  // What sits at the end — a measure, a chevron.
  trailing?: ReactNode;
  // Drops the hairline for the last row of a group, where the group's own
  // spacing already separates it.
  rule?: boolean;
};

export const Row = forwardRef<HTMLButtonElement, RowProps>(function Row(
  { leading, name, meta, trailing, rule = true, className, type = "button", ...props },
  ref,
) {
  const merged = [styles.row, rule ? undefined : styles.flush, className]
    .filter(Boolean)
    .join(" ");

  return (
    <button ref={ref} type={type} className={merged} {...props}>
      {leading ? <span className={styles.leading}>{leading}</span> : null}
      <span className={styles.body}>
        <Text as="span" variant="name">
          {name}
        </Text>
        {meta ? (
          <Text as="span" variant="meta">
            {meta}
          </Text>
        ) : null}
      </span>
      {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
    </button>
  );
});
