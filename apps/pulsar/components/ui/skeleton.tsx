import styles from "./skeleton.module.css";

// docs/pulsar/DESIGN.md, the day while it loads: plain blocks in the line
// colour. No shimmer, no gradient, no animation — a log that is still arriving
// says so by standing still. Radix's own Skeleton is off the door for exactly
// that: it paints from its own theme, not from the token table.
type Shape = "title" | "name" | "meta" | "label" | "mark";

// A block stands where a piece of type will land, so its height is that role's
// own size (docs/pulsar/DESIGN.md "Type") rather than a number of its own.
const shapes: Record<Shape, string> = {
  title: styles.title,
  name: styles.name,
  meta: styles.meta,
  label: styles.label,
  mark: styles.mark,
};

const widths = {
  full: styles.full,
  wide: styles.wide,
  half: styles.half,
  short: styles.short,
};

export function Skeleton({
  shape = "name",
  width = "full",
}: {
  shape?: Shape;
  width?: keyof typeof widths;
}) {
  // The screen says it is loading in words; a placeholder has nothing to read.
  return <span aria-hidden className={`${styles.block} ${shapes[shape]} ${widths[width]}`} />;
}
