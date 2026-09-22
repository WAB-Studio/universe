import { Separator as ThemesSeparator, type SeparatorProps } from "@radix-ui/themes";

import styles from "./separator.module.css";

// The hairline that rules one group from the next. docs/pulsar/DESIGN.md: never
// a card, never a border box. A `Row` draws its own; this is for everything else.
export function Separator({ className, ...props }: SeparatorProps) {
  return (
    <ThemesSeparator
      size="4"
      {...props}
      className={className ? `${styles.rule} ${className}` : styles.rule}
    />
  );
}
