"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

import styles from "./chip.module.css";

// docs/pulsar/DESIGN.md "Decisions taken here": a cadence is chosen with chips
// and never a menu, and a quantity is offered already filled. Two shapes, one
// control: the labelled pill, and the compact toggle the seven weekdays take.
type ChipProps = Omit<ComponentPropsWithoutRef<"button">, "children"> & {
  children?: ReactNode;
  selected?: boolean;
  shape?: "pill" | "day";
  // A quantity is a figure, and a figure is set in mono.
  mono?: boolean;
};

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { children, selected, shape = "pill", mono, className, type = "button", ...props },
  ref,
) {
  const merged = [
    styles.chip,
    shape === "day" ? styles.day : styles.pill,
    selected ? styles.selected : undefined,
    mono ? styles.mono : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button ref={ref} type={type} aria-pressed={selected ?? false} className={merged} {...props}>
      {children}
    </button>
  );
});
